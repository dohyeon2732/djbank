import { appendFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BrandCount, Question, RawAnswer, Run, Segment } from '../src/types';
import { ENGINE_IDS } from '../src/runner/types';
import type { EngineId, EngineProgress, JobStatus, RunnerConfig } from '../src/runner/types';
import { aggregate } from './aggregate';
import type { ScoredAnswer } from './aggregate';
import { loadConfig } from './config';
import { EngineError, callerFor, isFakeMode } from './engines';
import { ARCHIVE_DIR, DATA_DIR, readRows, writeRows } from './files';
import { JUDGE_VERSION, judge } from './judge';
import { loadKeys } from './keys';

export const REAL_MODE = '실측';
const FAKE_MODE = '연습(fake)';
const EXCERPT_LIMIT = 600;
const WAVE_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

const isReal = (run: Run) => run.mode === REAL_MODE;

export function nextWaveName(runs: Run[]): string {
  const taken = new Set(runs.map((r) => r.wave));
  let index = runs.filter(isReal).length + 1;
  while (taken.has(`W${index}`)) index += 1;
  return `W${index}`;
}

/** 실측이나 연습 기록이 하나도 없고 모의 데이터만 있으면, 첫 실행 때 모의 데이터를 보관 폴더로 옮깁니다. */
export function replacesMock(runs: Run[]): boolean {
  return runs.length > 0 && runs.every((r) => r.mode.includes('모의'));
}

const idleStatus = (): JobStatus => ({
  state: 'idle',
  wave: null,
  startedAt: null,
  finishedAt: null,
  engines: [],
  message: null,
});

let status: JobStatus = idleStatus();
let controller: AbortController | null = null;

export const getStatus = (): JobStatus => structuredClone(status);

export function cancelRun(): JobStatus {
  if (status.state === 'running' && controller) {
    status.state = 'cancelling';
    status.message = '진행 중인 호출이 끝나는 대로 멈춥니다. 이번 회차는 저장하지 않습니다.';
    controller.abort(new Error('사용자가 실행을 멈췄습니다'));
  }
  return getStatus();
}

interface Task {
  question: Question;
  engine: EngineId;
  rep: number;
}

/** 실행을 시작하고 바로 돌아옵니다. 진행 상황은 getStatus로 읽습니다. */
export function startRun(root: string, waveInput: unknown, limitInput?: unknown): JobStatus {
  if (status.state === 'running' || status.state === 'cancelling') {
    throw new Error('이미 실행 중입니다. 끝나거나 멈춘 뒤 다시 시작하세요.');
  }
  const wave = typeof waveInput === 'string' ? waveInput.trim() : '';
  if (!WAVE_PATTERN.test(wave)) {
    throw new Error('회차 이름은 영문, 숫자, -, _ 로 20자 이내여야 합니다. 예: W1');
  }

  const config = loadConfig(root);
  const { keys } = loadKeys(root);
  const fake = isFakeMode();
  const engines = ENGINE_IDS.filter((id) => config.engines[id].enabled && (fake || keys[id]));
  if (engines.length === 0) {
    throw new Error('실행할 엔진이 없습니다. 엔진을 하나 이상 켜고, 키 파일에 그 엔진의 키를 넣으세요.');
  }
  const all = readRows<Question>(root, 'questions');
  if (all.length === 0) throw new Error('public/data/questions.json에 질문이 없습니다.');
  // 시험 실행: 앞에서부터 몇 문항만 묻습니다. 0이거나 비어 있으면 전체입니다.
  const limit = typeof limitInput === 'number' && limitInput > 0 ? Math.floor(limitInput) : all.length;
  const questions = all.slice(0, limit);

  const tasks: Task[] = engines.flatMap((engine) =>
    questions.flatMap((question) =>
      Array.from({ length: config.repetitions }, (_, i) => ({ question, engine, rep: i + 1 })),
    ),
  );

  controller = new AbortController();
  status = {
    state: 'running',
    wave,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    engines: engines.map(
      (id): EngineProgress => ({
        id,
        model: config.engines[id].model,
        planned: tasks.filter((t) => t.engine === id).length,
        done: 0,
        failed: 0,
        mentioned: 0,
        inputTokens: 0,
        outputTokens: 0,
        lastError: null,
      }),
    ),
    message: null,
  };

  void execute(root, wave, config, keys, tasks, questions.length, controller.signal, fake).catch((error: unknown) => {
    status.state = 'failed';
    status.finishedAt = new Date().toISOString();
    status.message = `저장 중 오류: ${(error as Error).message}`;
  });
  return getStatus();
}

async function execute(
  root: string,
  wave: string,
  config: RunnerConfig,
  keys: Partial<Record<EngineId, string>>,
  tasks: Task[],
  questionCount: number,
  signal: AbortSignal,
  fake: boolean,
): Promise<void> {
  // 원본 응답 전문은 회차마다 한 줄씩 바로 적어 둡니다. 실행이 멈춰도 남습니다.
  const archiveDir = join(root, ARCHIVE_DIR);
  mkdirSync(archiveDir, { recursive: true });
  const archivePath = join(archiveDir, `${wave}-${Date.now()}.jsonl`);
  const answers: ScoredAnswer[] = [];

  const runTask = async (task: Task) => {
    const progress = status.engines.find((e) => e.id === task.engine);
    if (!progress || signal.aborted) return;
    try {
      const answer = await callerFor(task.engine)({
        question: task.question.question,
        model: config.engines[task.engine].model,
        key: keys[task.engine] ?? '',
        webSearch: true,
        signal,
      });
      const verdict = judge(answer.text, answer.citations, config);
      answers.push({
        wave,
        qid: task.question.id,
        engine: task.engine,
        rep: task.rep,
        mention: verdict.mention,
        rank: verdict.rank,
        rec: null,
        sentiment: null,
        brands: verdict.brands,
        cites: verdict.cites,
        excerpt: answer.text.slice(0, EXCERPT_LIMIT) || null,
        ownCites: verdict.ownCites,
      });
      appendFileSync(
        archivePath,
        `${JSON.stringify({ wave, qid: task.question.id, engine: task.engine, rep: task.rep, at: new Date().toISOString(), ...answer, verdict })}\n`,
      );
      progress.done += 1;
      progress.mentioned += verdict.mention ? 1 : 0;
      progress.inputTokens += answer.inputTokens;
      progress.outputTokens += answer.outputTokens;
      progress.model = answer.model;
    } catch (error) {
      if (signal.aborted) return;
      progress.done += 1;
      progress.failed += 1;
      progress.lastError = error instanceof EngineError ? error.message : `오류: ${(error as Error).message}`;
    }
  };

  // 엔진마다 따로 줄을 세워, 한 엔진이 느려도 다른 엔진은 계속 진행합니다.
  await Promise.all(
    status.engines.map(async ({ id }) => {
      const queue = tasks.filter((t) => t.engine === id);
      const workers = Array.from({ length: config.concurrency }, async () => {
        for (let task = queue.shift(); task && !signal.aborted; task = queue.shift()) {
          await runTask(task);
        }
      });
      await Promise.all(workers);
    }),
  );

  status.finishedAt = new Date().toISOString();
  if (signal.aborted) {
    status.state = 'cancelled';
    status.message = `실행을 멈췄습니다. ${wave} 회차는 저장하지 않았습니다. 받은 응답 원문은 ${ARCHIVE_DIR}/ 폴더에 남아 있습니다.`;
    return;
  }
  if (answers.length === 0) {
    status.state = 'failed';
    status.message = '성공한 호출이 없어 저장하지 않았습니다. 엔진별 오류를 확인하세요.';
    return;
  }

  save(root, wave, config, answers, tasks.length, status.engines.length, questionCount, fake);
  status.state = 'done';
  const failed = tasks.length - answers.length;
  status.message = `${wave} 회차를 저장했습니다. 성공 ${answers.length}건${failed > 0 ? `, 실패 ${failed}건` : ''}.`;
}

function save(
  root: string,
  wave: string,
  config: RunnerConfig,
  answers: ScoredAnswer[],
  planned: number,
  engineCount: number,
  questionCount: number,
  fake: boolean,
): void {
  const questions = readRows<Question>(root, 'questions');
  let runs = readRows<Run>(root, 'runs');
  let segments = readRows<Segment>(root, 'segments');
  let brands = readRows<BrandCount>(root, 'brands');
  let responses = readRows<RawAnswer>(root, 'responses');

  if (replacesMock(runs)) {
    const backup = join(root, ARCHIVE_DIR, `mock-data-${Date.now()}`);
    mkdirSync(backup, { recursive: true });
    for (const file of ['runs', 'segments', 'brands', 'responses']) {
      const source = join(root, DATA_DIR, `${file}.json`);
      if (existsSync(source)) copyFileSync(source, join(backup, `${file}.json`));
    }
    runs = [];
    segments = [];
    brands = [];
    responses = [];
  }

  // 같은 이름의 회차를 다시 돌리면 이전 값을 새 값으로 바꿉니다.
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
    mode: fake ? FAKE_MODE : REAL_MODE,
  };

  const sorted = [...answers].sort(
    (a, b) => a.qid.localeCompare(b.qid) || a.engine.localeCompare(b.engine) || a.rep - b.rep,
  );
  writeRows(root, 'responses', [...others(responses), ...sorted.map(({ ownCites: _, ...row }) => row)]);
  writeRows(root, 'segments', [...others(segments), ...result.segments]);
  writeRows(root, 'brands', [...others(brands), ...result.brands]);
  writeRows(root, 'runs', [...others(runs), run]);
}
