import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { ENGINE_IDS } from '../src/runner/types.js';
import type { RunnerOverview } from '../src/runner/types.js';
import type { Question, Run } from '../src/types.js';
import { loadConfig, normalizeConfig, saveConfig } from './config.js';
import { buildOverview, testConnection } from './core.js';
import { readRows } from './files.js';
import { isFakeMode } from './engines.js';
import { handleDb, loadDashboardData } from './hosted.js';
import { cancelRun, getStatus, startRun } from './job.js';
import { loadKeys, readEnvFile } from './keys.js';
import { dbFromEnv } from './supabase.js';

/** 화면(src/runner/client.ts)이 모든 요청에 붙이는 헤더. */
export const RUNNER_HEADER = 'x-djbank-runner';
const MAX_BODY = 200_000;

const overview = (root: string): RunnerOverview =>
  buildOverview('local', loadConfig(root), loadKeys(root), readRows<Run>(root, 'runs'), readRows<Question>(root, 'questions'));

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
      // 키 파일에 Supabase 설정이 있으면 배포된 사이트와 같은 DB에 저장합니다. 없으면 public/data 파일을 씁니다.
      // 연습 모드는 가짜 답변이 실제 DB에 섞이지 않도록 항상 파일에 저장합니다(테스트용 설정 파일을 따로 준 경우는 예외).
      const database = () =>
        isFakeMode() && !process.env.DJBANK_ENV_FILE ? null : dbFromEnv(readEnvFile(root).values);

      // 대시보드 데이터. DB 설정이 없으면 404로 답해 화면이 public/data의 JSON을 읽게 합니다.
      server.middlewares.use('/api/data', (_req, res) => {
        void (async () => {
          const db = database();
          if (!db) return send(res, 404, { error: 'Supabase 설정이 없습니다.' });
          try {
            return send(res, 200, await loadDashboardData(db));
          } catch (error) {
            return send(res, 502, { error: (error as Error).message });
          }
        })();
      });

      server.middlewares.use('/api/runner', (req, res) => {
        void (async () => {
          if (!isTrusted(req)) return send(res, 403, { error: '이 화면에서 보낸 요청만 받습니다.' });
          const action = new URL(req.url ?? '/', 'http://localhost').searchParams.get('action') ?? '';
          try {
            const db = database();
            if (db) {
              // 이 컴퓨터에서 연 화면은 로그인 없이 씁니다(다른 출처의 요청은 위에서 걸러집니다).
              const body = req.method === 'POST' ? ((await readBody(req)) as Record<string, unknown>) : {};
              const result = await handleDb(db, loadKeys(root), action, req.method ?? 'GET', body);
              return send(res, result.status, result.body);
            }
            switch (`${req.method} ${action}`) {
              case 'GET overview':
                return send(res, 200, overview(root));
              case 'POST config':
                saveConfig(root, await readBody(req));
                return send(res, 200, overview(root));
              case 'POST test': {
                const body = (await readBody(req)) as { engine?: string; config?: unknown };
                const id = ENGINE_IDS.find((e) => e === body.engine);
                if (!id) return send(res, 400, { error: '알 수 없는 엔진입니다.' });
                const config = body.config ? normalizeConfig(body.config) : loadConfig(root);
                return send(res, 200, await testConnection(id, config, loadKeys(root).keys[id]));
              }
              case 'POST start': {
                const { wave, limit } = (await readBody(req)) as { wave?: unknown; limit?: unknown };
                return send(res, 200, startRun(root, wave, limit));
              }
              case 'GET status':
                return send(res, 200, getStatus());
              case 'POST cancel':
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
