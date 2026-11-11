import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthError, login, refresh, verify } from '../server/auth.js';
import { handleDb } from '../server/hosted.js';
import { loadKeysFromEnv } from '../server/keys.js';
import { dbFromEnv } from '../server/supabase.js';

/**
 * Vercel 함수: /api/runner?action=...
 * 로컬 개발 서버에서는 같은 주소를 server/plugin.ts가 받습니다.
 */
export const config = { maxDuration: 300 };

type Request = IncomingMessage & { body?: unknown };

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req: Request, res: ServerResponse): Promise<void> {
  const db = dbFromEnv(process.env);
  if (!db) return send(res, 503, { error: 'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.' });

  const action = new URL(req.url ?? '/', 'http://localhost').searchParams.get('action') ?? '';
  const method = req.method ?? 'GET';
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

  try {
    if (method === 'POST' && action === 'login') return send(res, 200, await login(db, body.email, body.password));
    if (method === 'POST' && action === 'refresh') return send(res, 200, await refresh(db, body.refreshToken));
    await verify(db, req.headers.authorization);
  } catch (error) {
    if (error instanceof AuthError) return send(res, 401, { error: error.message });
    return send(res, 500, { error: (error as Error).message });
  }

  const result = await handleDb(db, loadKeysFromEnv(), action, method, body);
  send(res, result.status, result.body);
}
