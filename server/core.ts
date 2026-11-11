import type { BrandCount, Question, RawAnswer, Run, Segment } from '../src/types.js';
import { ENGINE_IDS } from '../src/runner/types.js';
import type { EngineId, RunnerConfig, RunnerOverview } from '../src/runner/types.js';
import { aggregate } from './aggregate.js';
import type { ScoredAnswer } from './aggregate.js';
import { ENGINES, EngineError, callerFor, isFakeMode } from './engines.js';
import type { EngineAnswer } from './engines.js';
import { JUDGE_VERSION, judge } from './judge.js';
import type { Judgement } from './judge.js';
import { KEY_NAMES } from './keys.js';
import type { LoadedKeys } from './keys.js';

/**
 * 로컬 실행 서버(job.ts)와 Vercel 함수(hosted.ts)가 함께 쓰는 로직.
 * 파일이나 네트워크 저장소를 직접 만지지 않습니다.
 */

export const REAL_MODE = '실측';
export const FAKE_MODE = '연습(fake)';
const EXCERPT_LIMIT = 600;
const WAVE_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

const isReal = (run: Run) => run.mode === REAL_MODE;

export function nextWaveName(runs: Run[]): string {
  const taken = new Set(runs.map((r) => r.wave));
  let index = runs.filter(isReal).length + 1;
  while (taken.has(`W${index}`)) index += 1;
  return `W${index}`;
}

/** 모의 데이터만 있으면 첫 실행 때 모의 데이터를 걷어내고 새로 쌓습니다. */
export function replacesMock(runs: Run[]): boolean {
  return runs.length > 0 && runs.every((r) => r.mode.includes('모의'));
}

export function parseWave(input: unknown): string {
  const wave = typeof input === 'string' ? input.trim() : '';
  if (!WAVE_PATTERN.test(wave)) {
    throw new Error('회차 이름은 영문, 숫자, -, _ 로 20자 이내여야 합니다. 예: W1');
  }
  return wave;
}

export function buildOverview(
  mode: RunnerOverview['mode'],
  config: RunnerConfig,
  loaded: LoadedKeys,
  runs: Run[],
  questions: Question[],
): RunnerOverview {
  return {
    mode,
    config,
    engines: ENGINE_IDS.map((id) => ({
      id,
      name: ENGINES[id].name,
      keyName: KEY_NAMES[id],
      keyPresent: Boolean(loaded.keys[id]),
    })),
    envFile: loaded.file,
    questionCount: questions.length,
    questionIds: questions.map((q) => q.id),
    nextWave: nextWaveName(runs),
    replacesMock: replacesMock(runs),
    existingWaves: runs.map((r) => r.wave),
    unfinished: [],
    fakeMode: isFakeMode(),
  };
}

export interface Scored {
  row: ScoredAnswer;
  answer: EngineAnswer;
  verdict: Judgement;
}

/** 질문 하나를 엔진 하나에 묻고 규칙으로 채점합니다. */
export async function scoreOne(input: {
  wave: string;
  question: Question;
  engine: EngineId;
  rep: number;
  config: RunnerConfig;
  key: string;
  signal: AbortSignal;
}): Promise<Scored> {
  const { wave, question, engine, rep, config, key, signal } = input;
  const answer = await callerFor(engine)({
    question: question.question,
    model: config.engines[engine].model,
    key,
    webSearch: true,
    signal,
  });
  const verdict = judge(answer.text, answer.citations, config);
  return {
    answer,
    verdict,
    row: {
      wave,
      qid: question.id,
      engine,
      rep,
      mention: verdict.mention,
      rank: verdict.rank,
      rec: null,
      sentiment: null,
      brands: verdict.brands,
      cites: verdict.cites,
      excerpt: answer.text.slice(0, EXCERPT_LIMIT) || null,
      ownCites: verdict.ownCites,
    },
  };
}

export const errorText = (error: unknown): string =>
  error instanceof EngineError ? error.message : `오류: ${(error as Error).message}`;

export async function testConnection(
  engine: EngineId,
  config: RunnerConfig,
  key: string | undefined,
): Promise<{ ok: boolean; model: string; ms: number; message: string }> {
  const model = config.engines[engine].model;
  if (!key && !isFakeMode()) {
    return { ok: false, model, ms: 0, message: `${KEY_NAMES[engine]} 키가 등록되어 있지 않습니다.` };
  }
  const started = Date.now();
  try {
    const answer = await callerFor(engine)({
      question: '연결 확인입니다. "확인"이라고만 답하세요.',
      model,
      key: key ?? '',
      webSearch: false,
      signal: AbortSignal.timeout(60_000),
    });
    return { ok: true, model: answer.model, ms: Date.now() - started, message: '연결됨' };
  } catch (error) {
    return { ok: false, model, ms: Date.now() - started, message: errorText(error) };
  }
}

export interface DataFiles {
  runs: Run[];
  segments: Segment[];
  brands: BrandCount[];
  responses: RawAnswer[];
}

/** 새 회차를 기존 데이터에 합친 결과를 돌려줍니다. 같은 이름의 회차는 새 값으로 바꿉니다. */
export function mergeWave(
  existing: DataFiles,
  questions: Question[],
  input: {
    wave: string;
    config: RunnerConfig;
    answers: ScoredAnswer[];
    planned: number;
    engineCount: number;
    questionCount: number;
  },
): DataFiles {
  const { wave, config, answers, planned, engineCount, questionCount } = input;
  const base: DataFiles = replacesMock(existing.runs)
    ? { runs: [], segments: [], brands: [], responses: [] }
    : existing;
  const others = <T extends { wave: string }>(rows: T[]) => rows.filter((row) => row.wave !== wave);
  const result = aggregate(wave, questions, answers, config.ownBrand.name, config.ownDomains.length > 0);

  const run: Run = {
    wave,
    date: new Date().toISOString().slice(0, 10),
    planned,
    succeeded: answers.length,
    failed: planned - answers.length,
    engines: engineCount,
    questions: questionCount,
    judge_version: JUDGE_VERSION,
    mode: isFakeMode() ? FAKE_MODE : REAL_MODE,
  };
  const sorted = [...answers].sort(
    (a, b) => a.qid.localeCompare(b.qid) || a.engine.localeCompare(b.engine) || a.rep - b.rep,
  );
  return {
    responses: [...others(base.responses), ...sorted.map(({ ownCites: _, ...row }) => row)],
    segments: [...others(base.segments), ...result.segments],
    brands: [...others(base.brands), ...result.brands],
    runs: [...others(base.runs), run],
  };
}
