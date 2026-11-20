import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_IDS } from '../src/runner/types.js';
import type { BrandRule, RunnerConfig } from '../src/runner/types.js';
import { normalizeOwn } from '../src/lib/sources.js';
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
    // DJ Bank는 제주은행의 서비스라, 제주은행이 나와도 자사 언급으로 셉니다.
    aliases: ['DJ Bank', 'DJBank', 'DJ뱅크', 'DJ 뱅크', '디제이뱅크', '디제이 뱅크', 'DJ 더주는', '제주은행', '제주 은행'],
  },
  // 1금융권 은행 전체: 시중은행, 특수은행, 지방은행, 인터넷전문은행.
  // 제주은행은 자사(DJ Bank)로 세므로 여기에 넣지 않습니다.
  competitors: [
    { name: 'KB국민은행', aliases: ['KB국민은행', 'KB 국민은행', '국민은행', 'KB국민'] },
    { name: '신한은행', aliases: ['신한은행', '신한 은행'] },
    { name: '하나은행', aliases: ['하나은행', '하나 은행', 'KEB하나'] },
    { name: '우리은행', aliases: ['우리은행', '우리 은행'] },
    { name: 'SC제일은행', aliases: ['SC제일은행', 'SC 제일은행', '제일은행', '스탠다드차타드'] },
    { name: '한국씨티은행', aliases: ['한국씨티은행', '씨티은행', '시티은행'] },
    { name: 'iM뱅크', aliases: ['iM뱅크', 'iM 뱅크', '아이엠뱅크', '대구은행', 'DGB'] },
    { name: 'IBK기업은행', aliases: ['IBK기업은행', 'IBK 기업은행', '기업은행', 'IBK'] },
    { name: 'NH농협은행', aliases: ['NH농협은행', 'NH 농협은행', '농협은행', 'NH농협'] },
    { name: 'KDB산업은행', aliases: ['KDB산업은행', 'KDB 산업은행', '산업은행', 'KDB'] },
    { name: 'Sh수협은행', aliases: ['Sh수협은행', 'Sh 수협은행', '수협은행'] },
    { name: 'BNK부산은행', aliases: ['BNK부산은행', 'BNK 부산은행', '부산은행'] },
    { name: 'BNK경남은행', aliases: ['BNK경남은행', 'BNK 경남은행', '경남은행'] },
    { name: '광주은행', aliases: ['광주은행'] },
    { name: '전북은행', aliases: ['전북은행'] },
    { name: '카카오뱅크', aliases: ['카카오뱅크', '카카오 뱅크', '카뱅'] },
    { name: '케이뱅크', aliases: ['케이뱅크', '케이 뱅크', 'K뱅크', 'Kbank'] },
    { name: '토스뱅크', aliases: ['토스뱅크', '토스 뱅크'] },
  ],
  // 도메인 또는 특정 경로(예: mkt.rememberapp.co.kr/djbank). 리멤버 사이트 전체를 자사로 봅니다.
  ownDomains: ['rememberapp.co.kr', 'remember.co.kr'],
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
    ownDomains: raw.ownDomains
      ? cleanList(raw.ownDomains).map(normalizeOwn).filter(Boolean)
      : DEFAULT_CONFIG.ownDomains,
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
