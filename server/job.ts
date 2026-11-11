import { appendFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BrandCount, Question, RawAnswer, Run, Segment } from '../src/types.js';
import { ENGINE_IDS } from '../src/runner/types.js';
import type { EngineId, EngineProgress, JobStatus, RunnerConfig } from '../src/runner/types.js';
import type { ScoredAnswer } from './aggregate.js';
import { loadConfig } from './config.js';
import { errorText, mergeWave, parseWave, replacesMock, scoreOne } from './core.js';
import { isFakeMode } from './engines.js';
import { ARCHIVE_DIR, DATA_DIR, readRows, writeRows } from './files.js';
import { loadKeys } from './keys.js';

/** 로컬 실행: 이 프로세스가 직접 엔진을 호출하고 public/data 파일에 저장합니다. */

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
  const wave = parseWave(waveInput);
  const config = loadConfig(root);
  const { keys } = loadKeys(root);
  const engines = ENGINE_IDS.filter((id) => config.engines[id].enabled && (isFakeMode() || keys[id]));
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

  void execute(root, wave, config, keys, tasks, questions.length, controller.signal).catch((error: unknown) => {
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
      const { row, answer, verdict } = await scoreOne({
        wave,
        question: task.question,
        engine: task.engine,
        rep: task.rep,
        config,
        key: keys[task.engine] ?? '',
        signal,
      });
      answers.push(row);
      appendFileSync(
        archivePath,
        `${JSON.stringify({ wave, qid: row.qid, engine: row.engine, rep: row.rep, at: new Date().toISOString(), ...answer, verdict })}\n`,
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
      progress.lastError = errorText(error);
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

  const existing = {
    runs: readRows<Run>(root, 'runs'),
    segments: readRows<Segment>(root, 'segments'),
    brands: readRows<BrandCount>(root, 'brands'),
    responses: readRows<RawAnswer>(root, 'responses'),
  };
  if (replacesMock(existing.runs)) {
    const backup = join(root, ARCHIVE_DIR, `mock-data-${Date.now()}`);
    mkdirSync(backup, { recursive: true });
    for (const file of Object.keys(existing)) {
      const source = join(root, DATA_DIR, `${file}.json`);
      if (existsSync(source)) copyFileSync(source, join(backup, `${file}.json`));
    }
  }
  const merged = mergeWave(existing, readRows<Question>(root, 'questions'), {
    wave,
    config,
    answers,
    planned: tasks.length,
    engineCount: status.engines.length,
    questionCount,
  });
  for (const [file, rows] of Object.entries(merged)) writeRows(root, file, rows);

  status.state = 'done';
  const failed = tasks.length - answers.length;
  status.message = `${wave} 회차를 저장했습니다. 성공 ${answers.length}건${failed > 0 ? `, 실패 ${failed}건` : ''}.`;
}
