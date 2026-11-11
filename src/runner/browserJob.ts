import { runner } from './client';
import type { EngineId, EngineProgress, JobStatus, RunnerConfig } from './types';

interface BrowserJobInput {
  wave: string;
  config: RunnerConfig;
  engines: EngineId[];
  questionIds: string[];
  signal: AbortSignal;
  onUpdate: (status: JobStatus) => void;
}

const keyOf = (task: { qid: string; engine: EngineId; rep: number }) => `${task.qid}|${task.engine}|${task.rep}`;

/**
 * DB 모드의 실행. 서버리스 함수는 오래 켜 둘 수 없어서 이 탭이 질문을 한 건씩 요청합니다.
 * 응답은 받는 즉시 DB에 저장되므로, 탭이 닫히거나 멈춰도 같은 회차 이름으로 다시 시작하면
 * 받은 데서부터 이어집니다. 모두 끝나면 집계를 만들어 대시보드에 공개합니다.
 */
export async function runInBrowser(input: BrowserJobInput): Promise<void> {
  const { wave, config, engines, questionIds, signal, onUpdate } = input;
  const status: JobStatus = {
    state: 'running',
    wave,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    engines: [],
    message: '이 탭이 질문을 한 건씩 보내고 있습니다. 응답은 받는 즉시 저장됩니다.',
  };
  const progress = new Map<EngineId, EngineProgress>();
  const publish = () => onUpdate({ ...status, engines: [...progress.values()].map((p) => ({ ...p })) });

  const allTasks = engines.flatMap((engine) =>
    questionIds.flatMap((qid) =>
      Array.from({ length: config.repetitions }, (_, index) => ({ qid, engine, rep: index + 1 })),
    ),
  );
  for (const id of engines) {
    progress.set(id, {
      id,
      model: config.engines[id].model,
      planned: allTasks.filter((t) => t.engine === id).length,
      done: 0,
      failed: 0,
      mentioned: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastError: null,
    });
  }
  publish();

  try {
    // 이어받기: 이미 받아 둔 응답은 건너뛰고 진행률에 반영합니다.
    const begun = await runner.begin(wave);
    const answered = new Map(begun.answered.map((a) => [keyOf(a), a]));
    const planned = new Set(allTasks.map(keyOf));
    let resumed = 0;
    for (const [key, row] of answered) {
      const mine = progress.get(row.engine);
      if (!mine || !planned.has(key)) continue;
      mine.done += 1;
      mine.mentioned += row.mention ? 1 : 0;
      resumed += 1;
    }
    if (resumed > 0) status.message = `받아 둔 응답 ${resumed}건에 이어서 진행합니다. 응답은 받는 즉시 저장됩니다.`;
    publish();

    await Promise.all(
      engines.map(async (engine) => {
        const queue = allTasks.filter((t) => t.engine === engine && !answered.has(keyOf(t)));
        const mine = progress.get(engine);
        if (!mine) return;
        const worker = async () => {
          for (let task = queue.shift(); task && !signal.aborted; task = queue.shift()) {
            try {
              const result = await runner.ask({ wave, config, ...task }, signal);
              mine.mentioned += result.mention ? 1 : 0;
              mine.inputTokens += result.inputTokens;
              mine.outputTokens += result.outputTokens;
              mine.model = result.model;
            } catch (error) {
              if (signal.aborted) return;
              mine.failed += 1;
              mine.lastError = (error as Error).message;
            }
            mine.done += 1;
            publish();
          }
        };
        await Promise.all(Array.from({ length: config.concurrency }, worker));
      }),
    );

    const succeeded = [...progress.values()].reduce((sum, p) => sum + p.done - p.failed, 0);
    status.finishedAt = new Date().toISOString();
    if (signal.aborted) {
      status.state = 'cancelled';
      status.message = `실행을 멈췄습니다. 받은 응답 ${succeeded}건은 저장돼 있습니다. ${wave} 회차로 다시 실행하면 이어서 진행합니다.`;
    } else if (succeeded === 0) {
      status.state = 'failed';
      status.message = '성공한 호출이 없습니다. 엔진별 오류를 확인하세요.';
    } else {
      status.message = '집계를 만드는 중입니다.';
      publish();
      const saved = await runner.finish({ wave, planned: allTasks.length, config });
      const failed = allTasks.length - saved.saved;
      status.state = 'done';
      status.message = `${wave} 회차를 저장했습니다. 성공 ${saved.saved}건${failed > 0 ? `, 실패 ${failed}건` : ''}.${failed > 0 ? ' 같은 회차 이름으로 다시 실행하면 실패한 건만 다시 묻습니다.' : ''}`;
    }
  } catch (error) {
    status.state = 'failed';
    status.finishedAt = new Date().toISOString();
    status.message = `실행이 중단됐습니다: ${(error as Error).message}. 받은 응답은 저장돼 있어, 같은 회차로 다시 실행하면 이어집니다.`;
  }
  publish();
}
