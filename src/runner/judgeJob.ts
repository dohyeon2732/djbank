import { runner } from './client';
import type { JudgeTask, RunnerConfig } from './types';

export interface JudgeProgress {
  state: 'running' | 'done' | 'cancelled' | 'failed';
  wave: string;
  /** 이번에 채점할 답변 수와 그중 끝난 수. */
  planned: number;
  done: number;
  failed: number;
  /** 심각하게 틀렸다고 나온 답변 수. 상품 사실이 없으면 세지 않습니다. */
  critical: number;
  inputTokens: number;
  outputTokens: number;
  lastError: string | null;
  message: string;
}

interface JudgeJobInput {
  wave: string;
  config: RunnerConfig;
  /** true면 이미 채점한 답변도 다시 채점합니다(상품 사실이나 모델을 바꿨을 때). */
  redo: boolean;
  signal: AbortSignal;
  onUpdate: (progress: JudgeProgress) => void;
}

const WORKERS = 3;

/**
 * 한 회차의 AI 채점. 실행과 마찬가지로 이 탭이 한 건씩 요청하고, 결과는 받는 즉시 저장됩니다.
 * 중간에 멈춰도 채점한 것은 남고, 다시 시작하면 남은 답변만 채점합니다.
 */
export async function judgeInBrowser(input: JudgeJobInput): Promise<void> {
  const { wave, config, redo, signal, onUpdate } = input;
  const progress: JudgeProgress = {
    state: 'running',
    wave,
    planned: 0,
    done: 0,
    failed: 0,
    critical: 0,
    inputTokens: 0,
    outputTokens: 0,
    lastError: null,
    message: '채점할 답변을 찾는 중입니다.',
  };
  const publish = () => onUpdate({ ...progress });
  publish();

  try {
    const { tasks } = await runner.judgeList(wave);
    const queue: JudgeTask[] = tasks.filter((task) => redo || !task.judged);
    progress.planned = queue.length;
    if (queue.length === 0) {
      progress.state = 'done';
      progress.message =
        tasks.length === 0
          ? `${wave} 회차에는 DJ Bank가 나온 답변이 없어 채점할 것이 없습니다.`
          : `${wave} 회차는 이미 모두 채점했습니다. 다시 채점하려면 "이미 채점한 답변도 다시"를 켜세요.`;
      publish();
      return;
    }
    progress.message = 'DJ Bank가 나온 답변을 하나씩 채점하고 있습니다. 끝날 때까지 이 탭을 열어 두세요.';
    publish();

    const worker = async () => {
      for (let task = queue.shift(); task && !signal.aborted; task = queue.shift()) {
        try {
          const result = await runner.judge({ wave, config, qid: task.qid, engine: task.engine, rep: task.rep }, signal);
          progress.critical += result.accuracy === 'critical' ? 1 : 0;
          progress.inputTokens += result.inputTokens;
          progress.outputTokens += result.outputTokens;
        } catch (error) {
          if (signal.aborted) return;
          progress.failed += 1;
          progress.lastError = (error as Error).message;
        }
        progress.done += 1;
        publish();
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));

    const succeeded = progress.done - progress.failed;
    if (succeeded > 0) {
      progress.message = '채점 결과를 숫자에 반영하는 중입니다.';
      publish();
      await runner.judgeFinish({ wave, config });
    }
    if (signal.aborted) {
      progress.state = 'cancelled';
      progress.message = `멈췄습니다. 채점한 ${succeeded}건은 저장돼 있습니다. 다시 시작하면 남은 답변만 채점합니다.`;
    } else if (succeeded === 0) {
      progress.state = 'failed';
      progress.message = '한 건도 채점하지 못했습니다. 아래 오류를 확인하세요.';
    } else {
      progress.state = 'done';
      progress.message = `${wave} 회차 ${succeeded}건을 채점했습니다.${progress.failed > 0 ? ` 실패 ${progress.failed}건은 다시 시작하면 그것만 채점합니다.` : ''}`;
    }
  } catch (error) {
    progress.state = 'failed';
    progress.message = `중간에 끊겼습니다: ${(error as Error).message}. 채점한 것은 저장돼 있습니다.`;
  }
  publish();
}
