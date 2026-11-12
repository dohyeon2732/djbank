import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_IDS } from '../src/runner/types.js';
import type { BrandRule, RunnerConfig } from '../src/runner/types.js';
import { writeJsonAtomic } from './files.js';

const CONFIG_FILE = 'runner.config.json';

/** 모델 이름은 각 회사가 수시로 바꿉니다. 실행 탭의 연결 테스트로 확인한 뒤 고쳐 쓰세요. */
export const DEFAULT_CONFIG: RunnerConfig = {
  engines: {
    chatgpt: { enabled: true, model: 'gpt-5' },
    gemini: { enabled: true, model: 'gemini-3.8-flash' },
    claude: { enabled: true, model: 'claude-haiku-5-5' },
    perplexity: { enabled: true, model: 'fast' },
  },
  repetitions: 1,
  concurrency: 3,
  ownBrand: {
    name: 'DJ Bank',
    aliases: ['DJ Bank', 'DJBank', 'DJ뱅크', 'DJ 뱅크', '디제이뱅크', '디제이 뱅크', 'DJ 더주는'],
  },
  competitors: [
    { name: 'IBK기업은행', aliases: ['IBK기업은행', 'IBK 기업은행', '기업은행', 'IBK'] },
    { name: 'KB국민은행', aliases: ['KB국민은행', 'KB 국민은행', '국민은행'] },
    { name: '신한은행', aliases: ['신한은행'] },
    { name: 'NH농협은행', aliases: ['NH농협은행', 'NH 농협은행', '농협은행'] },
    { name: '토스뱅크', aliases: ['토스뱅크'] },
    { name: '카카오뱅크', aliases: ['카카오뱅크', '카뱅'] },
  ],
  ownDomains: [],
};

export const LIMITS = {
  repetitions: { min: 1, max: 5 },
  concurrency: { min: 1, max: 8 },
} as const;

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

const cleanList = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()))].filter(
        Boolean,
      )
    : [];

function cleanBrand(value: unknown): BrandRule | null {
  if (!value || typeof value !== 'object') return null;
  const { name, aliases } = value as Partial<BrandRule>;
  if (typeof name !== 'string' || !name.trim()) return null;
  const list = cleanList(aliases);
  return { name: name.trim(), aliases: list.length > 0 ? list : [name.trim()] };
}

/** 화면에서 받은 값이든 파일에서 읽은 값이든 같은 규칙으로 정리합니다. */
export function normalizeConfig(input: unknown): RunnerConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<RunnerConfig>;
  const engines = { ...DEFAULT_CONFIG.engines };
  for (const id of ENGINE_IDS) {
    const given = raw.engines?.[id];
    if (given) {
      engines[id] = {
        enabled: typeof given.enabled === 'boolean' ? given.enabled : engines[id].enabled,
        model:
          typeof given.model === 'string' && given.model.trim() ? given.model.trim() : engines[id].model,
      };
    }
  }

  const competitors = Array.isArray(raw.competitors)
    ? raw.competitors.flatMap((c) => cleanBrand(c) ?? [])
    : DEFAULT_CONFIG.competitors;

  return {
    engines,
    repetitions: clamp(raw.repetitions, LIMITS.repetitions.min, LIMITS.repetitions.max, DEFAULT_CONFIG.repetitions),
    concurrency: clamp(raw.concurrency, LIMITS.concurrency.min, LIMITS.concurrency.max, DEFAULT_CONFIG.concurrency),
    ownBrand: cleanBrand(raw.ownBrand) ?? DEFAULT_CONFIG.ownBrand,
    competitors,
    ownDomains: raw.ownDomains ? cleanList(raw.ownDomains).map((d) => d.toLowerCase()) : [],
  };
}

export function loadConfig(root: string): RunnerConfig {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return DEFAULT_CONFIG;
  try {
    return normalizeConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(root: string, input: unknown): RunnerConfig {
  const config = normalizeConfig(input);
  writeJsonAtomic(join(root, CONFIG_FILE), config, true);
  return config;
}
