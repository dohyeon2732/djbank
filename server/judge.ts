import type { BrandRule, RunnerConfig } from '../src/runner/types.js';
import { matchOwn } from '../src/lib/sources.js';
import type { Citation } from './engines.js';

/** 규칙 채점 버전. 판정 규칙을 바꾸면 올려서 회차별로 구분합니다. */
export const JUDGE_VERSION = 'rule-v1';

export interface Judgement {
  mention: boolean;
  /** 은행 이름이 나온 순서로 매긴 점수. 첫 번째 3, 두 번째 2, 그 뒤 1. 언급하지 않으면 null. */
  rank: number | null;
  /** 함께 언급된 경쟁 은행, 등장 순서대로. */
  brands: string[];
  cites: number;
  ownCites: number;
}

function firstIndex(text: string, rule: BrandRule): number {
  const haystack = text.toLowerCase();
  const hits = rule.aliases
    .map((alias) => haystack.indexOf(alias.toLowerCase()))
    .filter((index) => index >= 0);
  return hits.length > 0 ? Math.min(...hits) : -1;
}

export function judge(text: string, citations: Citation[], config: RunnerConfig): Judgement {
  const own = firstIndex(text, config.ownBrand);
  const competitors = config.competitors
    .map((rule) => ({ name: rule.name, index: firstIndex(text, rule) }))
    .filter((hit) => hit.index >= 0)
    .sort((a, b) => a.index - b.index);

  let rank: number | null = null;
  if (own >= 0) {
    const before = competitors.filter((hit) => hit.index < own).length;
    rank = Math.max(1, 3 - before);
  }

  const unique = [...new Map(citations.map((c) => [c.url, c])).values()];
  return {
    mention: own >= 0,
    rank,
    brands: competitors.map((hit) => hit.name),
    cites: unique.length,
    ownCites: unique.filter((c) => matchOwn(c.url, c.title ?? null, config.ownDomains) !== null).length,
  };
}
