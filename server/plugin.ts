import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { ENGINE_IDS } from '../src/runner/types';
import type { EngineId, EngineTestResult, RunnerOverview } from '../src/runner/types';
import type { Question, Run } from '../src/types';
import { loadConfig, saveConfig } from './config';
import { ENGINES, EngineError, callerFor, isFakeMode } from './engines';
import { readRows } from './files';
import { cancelRun, getStatus, nextWaveName, replacesMock, startRun } from './job';
import { KEY_NAMES, loadKeys } from './keys';

/** 화면(src/runner/client.ts)이 모든 요청에 붙이는 헤더. */
export const RUNNER_HEADER = 'x-djbank-runner';
const MAX_BODY = 100_000;

function overview(root: string): RunnerOverview {
  const { file, keys } = loadKeys(root);
  const runs = readRows<Run>(root, 'runs');
  return {
    config: loadConfig(root),
    engines: ENGINE_IDS.map((id) => ({
      id,
      name: ENGINES[id].name,
      keyName: KEY_NAMES[id],
      keyPresent: Boolean(keys[id]),
    })),
    envFile: file,
    questionCount: readRows<Question>(root, 'questions').length,
    nextWave: nextWaveName(runs),
    replacesMock: replacesMock(runs),
    existingWaves: runs.map((r) => r.wave),
    fakeMode: isFakeMode(),
  };
}

async function testEngine(root: string, engine: EngineId): Promise<EngineTestResult> {
  const config = loadConfig(root);
  const { keys } = loadKeys(root);
  const model = config.engines[engine].model;
  const key = keys[engine];
  if (!key && !isFakeMode()) {
    return { ok: false, model, ms: 0, message: `${KEY_NAMES[engine]} 키가 키 파일에 없습니다.` };
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
    const message = error instanceof EngineError ? error.message : (error as Error).message;
    return { ok: false, model, ms: Date.now() - started, message };
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('요청 본문이 너무 큽니다.');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as unknown) : {};
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * 다른 사이트가 브라우저를 통해 이 주소로 요청을 보내 실행을 걸지 못하게 막습니다.
 * 사용자 정의 헤더가 붙은 요청은 다른 출처에서 보내려면 사전 확인(CORS)을 거쳐야 하는데,
 * 이 서버는 그 확인에 응하지 않습니다. Origin이 있으면 같은 호스트인지도 확인합니다.
 */
function isTrusted(req: IncomingMessage): boolean {
  if (req.headers[RUNNER_HEADER] !== '1') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** 개발 서버(npm run dev)에서만 켜지는 실행 API. 빌드 결과물에는 들어가지 않습니다. */
export function runnerApi(): Plugin {
  return {
    name: 'djbank-runner-api',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use('/api/runner', (req, res) => {
        void (async () => {
          if (!isTrusted(req)) return send(res, 403, { error: '이 화면에서 보낸 요청만 받습니다.' });
          const route = `${req.method} ${(req.url ?? '/').split('?')[0]}`;
          try {
            switch (route) {
              case 'GET /overview':
                return send(res, 200, overview(root));
              case 'POST /config':
                saveConfig(root, await readBody(req));
                return send(res, 200, overview(root));
              case 'POST /test': {
                const { engine } = (await readBody(req)) as { engine?: string };
                const id = ENGINE_IDS.find((e) => e === engine);
                if (!id) return send(res, 400, { error: '알 수 없는 엔진입니다.' });
                return send(res, 200, await testEngine(root, id));
              }
              case 'POST /start': {
                const { wave, limit } = (await readBody(req)) as { wave?: unknown; limit?: unknown };
                return send(res, 200, startRun(root, wave, limit));
              }
              case 'GET /status':
                return send(res, 200, getStatus());
              case 'POST /cancel':
                return send(res, 200, cancelRun());
              default:
                return send(res, 404, { error: '없는 경로입니다.' });
            }
          } catch (error) {
            return send(res, 400, { error: (error as Error).message });
          }
        })();
      });
    },
  };
}
