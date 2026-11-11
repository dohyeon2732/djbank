import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadDashboardData } from '../server/hosted.js';
import { dbFromEnv } from '../server/supabase.js';

/** Vercel 함수: /api/data. 대시보드가 읽는 측정 결과 전체. 로그인 없이 읽을 수 있습니다. */
export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  const db = dbFromEnv(process.env);
  if (!db) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: 'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.' }));
    return;
  }
  try {
    res.statusCode = 200;
    res.end(JSON.stringify(await loadDashboardData(db)));
  } catch (error) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (error as Error).message }));
  }
}
