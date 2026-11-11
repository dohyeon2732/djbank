import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { EngineId } from '../src/runner/types.js';

/** 프로젝트 루트에서 이 순서로 키 파일을 찾습니다. 둘 다 .gitignore에 들어 있습니다. */
// DJBANK_ENV_FILE로 다른 파일을 지정할 수 있습니다(테스트용 설정을 따로 둘 때).
const ENV_FILES = [process.env.DJBANK_ENV_FILE, 'djbank.env', '.env'].filter((name): name is string => Boolean(name));

export const KEY_NAMES: Record<EngineId, string> = {
  chatgpt: 'OPENAI_API_KEY',
  gemini: 'GOOGLE_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
};

export interface LoadedKeys {
  file: string | null;
  keys: Partial<Record<EngineId, string>>;
}

/**
 * 호출할 때마다 파일을 다시 읽어, 키를 바꾸면 서버를 다시 켜지 않아도 반영됩니다.
 * 키 값은 이 서버 프로세스 안에서만 쓰고 응답이나 로그로 내보내지 않습니다.
 */
export function readEnvFile(root: string): { file: string | null; values: Record<string, string | undefined> } {
  const file = ENV_FILES.find((name) => existsSync(resolve(root, name))) ?? null;
  return { file, values: file ? parseEnv(readFileSync(resolve(root, file), 'utf8')) : {} };
}

export function loadKeys(root: string): LoadedKeys {
  const { file, values } = readEnvFile(root);
  const keys: Partial<Record<EngineId, string>> = {};
  for (const [engine, name] of Object.entries(KEY_NAMES) as [EngineId, string][]) {
    const value = (values[name] ?? '').trim();
    if (value) keys[engine] = value;
  }
  return { file, keys };
}

/** 배포 환경(Vercel)에서는 키 파일 대신 프로젝트 환경변수에서 읽습니다. */
export function loadKeysFromEnv(): LoadedKeys {
  const keys: Partial<Record<EngineId, string>> = {};
  for (const [engine, name] of Object.entries(KEY_NAMES) as [EngineId, string][]) {
    const value = (process.env[name] ?? '').trim();
    if (value) keys[engine] = value;
  }
  return { file: null, keys };
}
