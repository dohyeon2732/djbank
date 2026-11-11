/**
 * Supabase(PostgREST) 접근. 서버에서만 쓰며 비밀 키로 호출합니다.
 * 별도 라이브러리 없이 REST로 부릅니다.
 */

export interface Db {
  url: string;
  secretKey: string;
  publishableKey: string;
}

type EnvMap = Record<string, string | undefined>;

/** 주소와 비밀 키가 모두 있을 때만 DB 모드가 됩니다. */
export function dbFromEnv(env: EnvMap): Db | null {
  const url = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const secretKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !secretKey) return null;
  return { url, secretKey, publishableKey: (env.SUPABASE_PUBLISHABLE_KEY ?? '').trim() };
}

const PAGE = 1000;

async function rest(db: Db, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${db.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: db.secretKey,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    if (response.status === 404 && detail.includes('PGRST205')) {
      throw new Error('Supabase에 테이블이 없습니다. 터미널에서 npm run db:schema, npm run db:seed를 차례로 실행하세요.');
    }
    throw new Error(`Supabase ${response.status}: ${detail}`);
  }
  return response;
}

/** 조건에 맞는 행을 모두 읽습니다. PostgREST가 한 번에 1000행까지만 주므로 나눠 읽습니다. */
export async function selectAll<T>(db: Db, table: string, query = ''): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const separator = query ? '&' : '';
    const response = await rest(db, `${table}?${query}${separator}limit=${PAGE}&offset=${offset}`);
    const page = (await response.json()) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** 기본 키가 같으면 덮어씁니다. */
export async function upsert(db: Db, table: string, rows: object[], onConflict: string): Promise<void> {
  for (let start = 0; start < rows.length; start += 500) {
    await rest(db, `${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(start, start + 500)),
    });
  }
}

export async function update(db: Db, table: string, filter: string, values: object): Promise<void> {
  await rest(db, `${table}?${filter}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(values),
  });
}

/** filter는 반드시 있어야 합니다. 조건 없는 전체 삭제를 막습니다. */
export async function remove(db: Db, table: string, filter: string): Promise<void> {
  if (!filter.includes('=')) throw new Error('삭제 조건이 없습니다.');
  await rest(db, `${table}?${filter}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
}

export const eq = (column: string, value: string) => `${column}=eq.${encodeURIComponent(value)}`;
