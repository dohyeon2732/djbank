import type { BrandCount, DashboardData, Question, RawAnswer, Run, Segment } from '../src/types.js';
import { summarizeSources } from './sources.js';
import type { CitedAnswer } from './sources.js';
import { ENGINE_IDS } from '../src/runner/types.js';
import type { AskResult, BeginResult, RunnerConfig, RunnerOverview } from '../src/runner/types.js';
import { aggregate } from './aggregate.js';
import type { ScoredAnswer } from './aggregate.js';
import { DEFAULT_CONFIG, normalizeConfig } from './config.js';
import { FAKE_MODE, REAL_MODE, buildOverview, errorText, parseWave, scoreOne, testConnection } from './core.js';
import { isFakeMode } from './engines.js';
import { JUDGE_VERSION } from './judge.js';
import type { LoadedKeys } from './keys.js';
import { eq, remove, selectAll, update, upsert } from './supabase.js';
import type { Db } from './supabase.js';

/**
 * Supabase에 저장하는 실행 API. 배포된 사이트(Vercel 함수)와 로컬 개발 서버가 함께 씁니다.
 * 함수는 오래 켜 둘 수 없어서 브라우저가 질문을 한 건씩 요청(ask)하고,
 * 응답은 받는 즉시 DB에 저장합니다. 끊겨도 같은 회차로 다시 시작하면 이어서 진행합니다.
 * 로그인 확인은 이 함수를 부르는 쪽(api/runner.ts, server/plugin.ts)이 맡습니다.
 */

export interface Reply {
  status: number;
  body: unknown;
}

const reply = (status: number, body: unknown): Reply => ({ status, body });

interface RunRow extends Run {
  status: 'running' | 'done';
}

interface ResponseRow extends Omit<RawAnswer, 'mention' | 'brands'> {
  mention: boolean;
  brands: string[];
  own_cites: number;
}

const QUESTION_COLUMNS = 'id,question,category,demand,product,release,speaker,group,rationale';
const RUN_COLUMNS = 'wave,date,planned,succeeded,failed,engines,questions,judge_version,mode';
const RESPONSE_COLUMNS = 'wave,qid,engine,rep,mention,rank,rec,sentiment,brands,cites,excerpt';

const loadQuestions = (db: Db) =>
  selectAll<Question>(db, 'questions', `select=${QUESTION_COLUMNS}&order=position.asc`);

// 질문셋은 실행 도중 바뀌지 않으므로, 함수가 켜져 있는 동안은 한 번 읽은 것을 다시 씁니다.
let questionCache: { at: number; rows: Question[] } | null = null;
async function cachedQuestions(db: Db): Promise<Question[]> {
  if (!questionCache || Date.now() - questionCache.at > 5 * 60_000) {
    questionCache = { at: Date.now(), rows: await loadQuestions(db) };
  }
  return questionCache.rows;
}

async function loadConfig(db: Db): Promise<RunnerConfig> {
  const rows = await selectAll<{ config: unknown }>(db, 'runner_config', 'select=config&id=eq.1');
  return rows[0] ? normalizeConfig(rows[0].config) : DEFAULT_CONFIG;
}

const inWaves = (waves: string[]) => `wave=in.(${waves.map((w) => `"${w}"`).join(',')})`;

/** 대시보드가 읽는 데이터. 저장이 끝난(done) 회차만 내보냅니다. */
export async function loadDashboardData(db: Db): Promise<Omit<DashboardData, 'answers'> & { responses: RawAnswer[] }> {
  const [questions, runs] = await Promise.all([
    loadQuestions(db),
    selectAll<Run>(db, 'runs', `select=${RUN_COLUMNS}&status=eq.done&order=created_at.asc`),
  ]);
  if (runs.length === 0) return { runs, questions, segments: [], brands: [], responses: [], sources: [] };
  const filter = inWaves(runs.map((r) => r.wave));
  const [segments, brands, responses, cited, config] = await Promise.all([
    selectAll<Segment>(db, 'segments', `select=*&${filter}`),
    selectAll<BrandCount>(db, 'brands', `select=*&${filter}&order=count.desc`),
    selectAll<RawAnswer>(db, 'responses', `select=${RESPONSE_COLUMNS}&${filter}&order=qid.asc,engine.asc,rep.asc`),
    selectAll<CitedAnswer>(db, 'response_raw', `select=wave,qid,engine,rep,citations&${filter}&order=qid.asc,engine.asc,rep.asc`),
    loadConfig(db),
  ]);
  return { runs, questions, segments, brands, responses, sources: summarizeSources(cited, config.ownDomains) };
}

async function overview(db: Db, keys: LoadedKeys): Promise<RunnerOverview> {
  const [config, questions, runs] = await Promise.all([
    loadConfig(db),
    cachedQuestions(db),
    selectAll<RunRow>(db, 'runs', `select=${RUN_COLUMNS},status&order=created_at.asc`),
  ]);
  const base = buildOverview('hosted', config, keys, runs.filter((r) => r.status === 'done'), questions);
  const unfinished = await Promise.all(
    runs
      .filter((r) => r.status === 'running')
      .map(async (r) => ({
        wave: r.wave,
        answered: (await selectAll<{ qid: string }>(db, 'responses', `select=qid&${eq('wave', r.wave)}`)).length,
      })),
  );
  return { ...base, unfinished };
}

export async function handleDb(
  db: Db,
  keys: LoadedKeys,
  action: string,
  method: string,
  body: Record<string, unknown>,
): Promise<Reply> {
  try {
    switch (`${method} ${action}`) {
      case 'GET overview':
        return reply(200, await overview(db, keys));

      case 'POST config': {
        const config = normalizeConfig(body);
        await upsert(db, 'runner_config', [{ id: 1, config, updated_at: new Date().toISOString() }], 'id');
        return reply(200, await overview(db, keys));
      }

      case 'POST test': {
        const engine = ENGINE_IDS.find((id) => id === body.engine);
        if (!engine) return reply(400, { error: '알 수 없는 엔진입니다.' });
        return reply(200, await testConnection(engine, normalizeConfig(body.config), keys.keys[engine]));
      }

      // 회차를 열거나 이어받습니다. 이미 받은 응답 목록을 돌려주면 화면이 그만큼 건너뜁니다.
      case 'POST begin': {
        const wave = parseWave(body.wave);
        const existing = (await selectAll<RunRow>(db, 'runs', `select=wave,status&${eq('wave', wave)}`))[0];
        // 이미 있는 회차(중단됐거나 저장이 끝난 회차)는 받아 둔 응답을 그대로 두고 빠진 것만 채웁니다.
        const answered =
          existing
            ? await selectAll<BeginResult['answered'][number]>(
                db,
                'responses',
                `select=qid,engine,rep,mention&${eq('wave', wave)}`,
              )
            : [];
        // 저장이 끝난 회차는 새 집계가 나올 때까지 대시보드에 그대로 둡니다.
        if (!existing) {
          await upsert(
            db,
            'runs',
            [{ wave, status: 'running', mode: isFakeMode() ? FAKE_MODE : REAL_MODE, judge_version: JUDGE_VERSION }],
            'wave',
          );
        }
        const result: BeginResult = { wave, answered };
        return reply(200, result);
      }

      case 'POST ask': {
        const engine = ENGINE_IDS.find((id) => id === body.engine);
        const question = (await cachedQuestions(db)).find((q) => q.id === body.qid);
        const key = engine ? keys.keys[engine] : undefined;
        if (!engine || !question) return reply(400, { error: '알 수 없는 엔진이나 질문입니다.' });
        if (!key && !isFakeMode()) return reply(400, { error: '이 엔진의 키가 등록되어 있지 않습니다.' });
        const wave = parseWave(body.wave);
        let scored;
        try {
          scored = await scoreOne({
            wave,
            question,
            engine,
            rep: typeof body.rep === 'number' && body.rep > 0 ? Math.floor(body.rep) : 1,
            config: normalizeConfig(body.config),
            key: key ?? '',
            signal: AbortSignal.timeout(280_000),
          });
        } catch (error) {
          return reply(502, { error: errorText(error) });
        }
        const { row, answer } = scored;
        const { ownCites, ...rest } = row;
        await upsert(
          db,
          'responses',
          [
            {
              ...rest,
              own_cites: ownCites,
              model: answer.model,
              input_tokens: answer.inputTokens,
              output_tokens: answer.outputTokens,
              created_at: new Date().toISOString(),
            },
          ],
          'wave,qid,engine,rep',
        );
        await upsert(
          db,
          'response_raw',
          [{ wave, qid: row.qid, engine, rep: row.rep, answer_text: answer.text, citations: answer.citations }],
          'wave,qid,engine,rep',
        );
        const result: AskResult = {
          mention: row.mention,
          model: answer.model,
          inputTokens: answer.inputTokens,
          outputTokens: answer.outputTokens,
        };
        return reply(200, result);
      }

      // 받은 응답으로 집계를 만들고 회차를 대시보드에 공개합니다.
      case 'POST finish': {
        const wave = parseWave(body.wave);
        const rows = await selectAll<ResponseRow>(db, 'responses', `select=*&${eq('wave', wave)}`);
        if (rows.length === 0) return reply(400, { error: '저장된 응답이 없어 회차를 마칠 수 없습니다.' });
        const config = normalizeConfig(body.config);
        const answers: ScoredAnswer[] = rows.map(({ own_cites, ...row }) => ({ ...row, ownCites: own_cites }));
        const result = aggregate(wave, await cachedQuestions(db), answers, config.ownBrand.name, config.ownDomains.length > 0);
        await remove(db, 'segments', eq('wave', wave));
        await remove(db, 'brands', eq('wave', wave));
        await upsert(db, 'segments', result.segments, 'wave,dim,name');
        await upsert(db, 'brands', result.brands, 'wave,brand');
        const planned = typeof body.planned === 'number' ? Math.max(rows.length, Math.floor(body.planned)) : rows.length;
        await update(db, 'runs', eq('wave', wave), {
          status: 'done',
          date: new Date().toISOString().slice(0, 10),
          planned,
          succeeded: rows.length,
          failed: planned - rows.length,
          engines: new Set(rows.map((r) => r.engine)).size,
          questions: new Set(rows.map((r) => r.qid)).size,
          finished_at: new Date().toISOString(),
        });
        return reply(200, { saved: rows.length });
      }

      // 중단된 회차의 받아 둔 응답을 버립니다. 저장이 끝난 회차는 지우지 않습니다.
      case 'POST discard': {
        const wave = parseWave(body.wave);
        await remove(db, 'runs', `${eq('wave', wave)}&status=eq.running`);
        return reply(200, await overview(db, keys));
      }

      default:
        return reply(404, { error: '없는 경로입니다.' });
    }
  } catch (error) {
    return reply(400, { error: (error as Error).message });
  }
}
