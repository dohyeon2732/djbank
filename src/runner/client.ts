import type { EngineId, EngineTestResult, JobStatus, RunnerConfig, RunnerOverview } from './types';

/** 로컬 실행 서버(server/plugin.ts)가 다른 출처의 요청과 구분하는 헤더. */
const HEADERS = { 'x-djbank-runner': '1', 'content-type': 'application/json' };
const BASE = '/api/runner';

export class RunnerUnavailable extends Error {}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new RunnerUnavailable('실행 서버에 연결하지 못했습니다.');
  }
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    // 정적 호스팅이나 vite preview에는 실행 API가 없어 HTML이나 404가 돌아옵니다.
    throw new RunnerUnavailable('이 화면에는 실행 서버가 없습니다.');
  }
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export const runner = {
  overview: () => request<RunnerOverview>('GET', '/overview'),
  saveConfig: (config: RunnerConfig) => request<RunnerOverview>('POST', '/config', config),
  test: (engine: EngineId) => request<EngineTestResult>('POST', '/test', { engine }),
  /** limit이 0이면 전체 질문, 아니면 앞에서부터 그 수만큼만 묻습니다. */
  start: (wave: string, limit: number) => request<JobStatus>('POST', '/start', { wave, limit }),
  status: () => request<JobStatus>('GET', '/status'),
  cancel: () => request<JobStatus>('POST', '/cancel'),
};
