import type {
  AskResult,
  BeginResult,
  EngineId,
  EngineTestResult,
  JobStatus,
  RunnerConfig,
  RunnerOverview,
} from './types';

const BASE = '/api/runner';
const SESSION_KEY = 'djbank-runner-session';

/** 실행 서버가 없는 화면(정적 미리보기 등). */
export class RunnerUnavailable extends Error {}
/** 배포된 사이트에서 로그인이 필요하거나 만료됐습니다. */
export class RunnerLocked extends Error {}

interface Session {
  accessToken: string;
  refreshToken: string;
  email: string;
}

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/** 로그인 정보는 이 탭이 열려 있는 동안만 기억합니다. */
function writeSession(session: Session | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 저장이 막힌 브라우저에서는 새로고침할 때마다 다시 로그인합니다.
  }
}

async function send(method: 'GET' | 'POST', action: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${BASE}?action=${action}`, {
      method,
      headers: {
        // 로컬 실행 서버는 x-djbank-runner로 다른 출처의 요청을 걸러내고,
        // 배포된 사이트는 로그인 토큰으로 실행 권한을 확인합니다.
        'x-djbank-runner': '1',
        authorization: `Bearer ${readSession()?.accessToken ?? ''}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RunnerUnavailable('실행 서버에 연결하지 못했습니다.');
  }
}

// 토큰이 만료되면 한 번만 새로 받아 같은 요청을 다시 보냅니다. 여러 요청이 동시에 만료돼도 갱신은 한 번입니다.
let refreshing: Promise<boolean> | null = null;
function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const session = readSession();
    if (!session?.refreshToken) return false;
    const response = await send('POST', 'refresh', { refreshToken: session.refreshToken });
    if (!response.ok) return false;
    writeSession((await response.json()) as Session);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request<T>(
  method: 'GET' | 'POST',
  action: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response = await send(method, action, body, signal);
  if (response.status === 401 && action !== 'login' && (await refreshSession())) {
    response = await send(method, action, body, signal);
  }
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    throw new RunnerUnavailable('이 화면에는 실행 서버가 없습니다.');
  }
  const data = (await response.json()) as T & { error?: string };
  if (response.status === 401) throw new RunnerLocked(data.error ?? '로그인이 필요합니다.');
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export const runner = {
  login: async (email: string, password: string) => {
    writeSession(await request<Session>('POST', 'login', { email, password }));
  },
  logout: () => writeSession(null),
  signedInAs: () => readSession()?.email ?? null,

  overview: () => request<RunnerOverview>('GET', 'overview'),
  saveConfig: (config: RunnerConfig) => request<RunnerOverview>('POST', 'config', config),
  test: (engine: EngineId, config: RunnerConfig) =>
    request<EngineTestResult>('POST', 'test', { engine, config }),

  // 파일 모드(local): 개발 서버가 실행을 맡고 화면은 진행 상황만 읽습니다.
  /** limit이 0이면 전체 질문, 아니면 앞에서부터 그 수만큼만 묻습니다. */
  start: (wave: string, limit: number) => request<JobStatus>('POST', 'start', { wave, limit }),
  status: () => request<JobStatus>('GET', 'status'),
  cancel: () => request<JobStatus>('POST', 'cancel'),

  // DB 모드(hosted): 브라우저가 한 건씩 묻고, 응답은 받는 즉시 저장됩니다.
  begin: (wave: string) => request<BeginResult>('POST', 'begin', { wave }),
  ask: (
    input: { wave: string; qid: string; engine: EngineId; rep: number; config: RunnerConfig },
    signal: AbortSignal,
  ) => request<AskResult>('POST', 'ask', input, signal),
  finish: (input: { wave: string; planned: number; config: RunnerConfig }) =>
    request<{ saved: number }>('POST', 'finish', input),
  discard: (wave: string) => request<RunnerOverview>('POST', 'discard', { wave }),
};
