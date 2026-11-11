// supabase/schema.sql을 실행해 테이블을 만듭니다. 여러 번 실행해도 안전합니다.
// 사용: npm run db:schema  (djbank.env의 SUPABASE_DB_URL 필요)
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import pg from 'pg';

const env = parseEnv(readFileSync('djbank.env', 'utf8'));
if (!env.SUPABASE_DB_URL) throw new Error('djbank.env에 SUPABASE_DB_URL이 없습니다.');

// Supabase는 자체 루트 인증서를 씁니다. 검증을 끄지 않고 그 인증서를 신뢰 목록에 넣어 연결합니다.
const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { ca: readFileSync('supabase/prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true },
  connectionTimeoutMillis: 15000,
});
await client.connect();
try {
  await client.query(readFileSync('supabase/schema.sql', 'utf8'));
  await client.query("notify pgrst, 'reload schema'");
  const { rows } = await client.query(
    "select c.relname as table, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1",
  );
  console.table(rows);
} finally {
  await client.end();
}
