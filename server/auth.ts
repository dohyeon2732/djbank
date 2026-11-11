import type { Db } from './supabase.js';

/**
 * 배포된 사이트의 실행 권한. Supabase 계정으로 로그인하고,
 * RUNNER_ALLOWED_EMAILS에 적힌 이메일만 실행할 수 있습니다.
 * 목록이 비어 있으면 아무도 실행할 수 없습니다(가입만 하면 누구나 쓰게 되는 일을 막습니다).
 */

export interface Session {
  accessToken: string;
  refreshToken: string;
  email: string;
}

const allowedEmails = (): string[] =>
  (process.env.RUNNER_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export class AuthError extends Error {}

async function authCall(db: Db, path: string, init: RequestInit): Promise<Record<string, unknown>> {
  if (!db.publishableKey) throw new AuthError('SUPABASE_PUBLISHABLE_KEY 환경변수가 없습니다.');
  const response = await fetch(`${db.url}/auth/v1/${path}`, {
    ...init,
    headers: {
      apikey: db.publishableKey,
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new AuthError(response.status === 400 ? '이메일이나 비밀번호가 맞지 않습니다.' : '로그인이 만료되었습니다.');
  }
  return data;
}

function ensureAllowed(email: string): void {
  const list = allowedEmails();
  if (list.length === 0) {
    throw new AuthError('RUNNER_ALLOWED_EMAILS 환경변수가 비어 있어 아무도 실행할 수 없습니다.');
  }
  if (!list.includes(email.toLowerCase())) throw new AuthError('이 계정에는 실행 권한이 없습니다.');
}

function toSession(data: Record<string, unknown>): Session {
  const user = (data.user ?? {}) as { email?: string };
  const email = user.email ?? '';
  ensureAllowed(email);
  return { accessToken: String(data.access_token ?? ''), refreshToken: String(data.refresh_token ?? ''), email };
}

export async function login(db: Db, email: unknown, password: unknown): Promise<Session> {
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw new AuthError('이메일과 비밀번호를 입력하세요.');
  }
  return toSession(
    await authCall(db, 'token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }),
  );
}

export async function refresh(db: Db, refreshToken: unknown): Promise<Session> {
  if (typeof refreshToken !== 'string' || !refreshToken) throw new AuthError('로그인이 만료되었습니다.');
  return toSession(
    await authCall(db, 'token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    }),
  );
}

// 실행 한 번에 요청이 수백 건이라, 확인한 토큰은 잠시 기억합니다.
const verified = new Map<string, number>();
const VERIFY_TTL_MS = 60_000;

/** 요청의 토큰이 유효하고 허용된 계정인지 확인합니다. 아니면 AuthError. */
export async function verify(db: Db, authorization: unknown): Promise<void> {
  const token = typeof authorization === 'string' ? authorization.replace(/^Bearer\s+/i, '').trim() : '';
  if (!token) throw new AuthError('로그인이 필요합니다.');
  const until = verified.get(token);
  if (until && until > Date.now()) return;
  const user = await authCall(db, 'user', { method: 'GET', headers: { authorization: `Bearer ${token}` } });
  ensureAllowed(String(user.email ?? ''));
  if (verified.size > 200) verified.clear();
  verified.set(token, Date.now() + VERIFY_TTL_MS);
}
