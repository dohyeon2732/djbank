import { wilson } from '../src/lib/selectors';
import type { BrandCount, Question, RawAnswer, Segment } from '../src/types';

/** 집계에 필요한 응답 한 건. ownCites는 화면용 responses.json에는 저장하지 않습니다. */
export interface ScoredAnswer extends RawAnswer {
  mention: boolean;
  brands: string[];
  ownCites: number;
}

const round = (value: number, digits = 4) => Number(value.toFixed(digits));
const average = (values: number[]) =>
  values.length > 0 ? round(values.reduce((sum, v) => sum + v, 0) / values.length, 3) : null;

/** 은행별 언급 수: 그 은행을 한 번이라도 언급한 답변 수. */
function brandMentions(answers: ScoredAnswer[], ownBrand: string): Map<string, number> {
  const counts = new Map<string, number>([[ownBrand, 0]]);
  for (const answer of answers) {
    if (answer.mention) counts.set(ownBrand, (counts.get(ownBrand) ?? 0) + 1);
    for (const brand of answer.brands) counts.set(brand, (counts.get(brand) ?? 0) + 1);
  }
  return counts;
}

function segment(
  wave: string,
  dim: string,
  name: string,
  group: string,
  answers: ScoredAnswer[],
  ownBrand: string,
  hasOwnDomains: boolean,
): Segment {
  const n = answers.length;
  const k = answers.filter((a) => a.mention).length;
  const interval = n > 0 ? wilson(k, n) : null;
  const counts = brandMentions(answers, ownBrand);
  const totalBrand = [...counts.values()].reduce((sum, v) => sum + v, 0);
  const totalCit = answers.reduce((sum, a) => sum + a.cites, 0);
  const ownCit = answers.reduce((sum, a) => sum + a.ownCites, 0);

  return {
    wave,
    dim,
    name,
    group,
    mention_p: n > 0 ? round(k / n) : null,
    lo: interval ? round(interval.lo) : null,
    hi: interval ? round(interval.hi) : null,
    k,
    n,
    rank_avg: average(answers.flatMap((a) => (a.rank == null ? [] : [a.rank]))),
    // 추천 강도, 감성, 정확도, 치명 환각은 AI 채점 단계가 생기면 채웁니다.
    rec_avg: null,
    sov: totalBrand > 0 ? round((counts.get(ownBrand) ?? 0) / totalBrand) : null,
    acc_rate: null,
    critical: null,
    sent_net: null,
    own_cit: hasOwnDomains ? ownCit : null,
    total_cit: totalCit,
    own_share: hasOwnDomains && totalCit > 0 ? round(ownCit / totalCit) : null,
  };
}

export function aggregate(
  wave: string,
  questions: Question[],
  answers: ScoredAnswer[],
  ownBrand: string,
  hasOwnDomains: boolean,
): { segments: Segment[]; brands: BrandCount[] } {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const make = (dim: string, name: string, group: string, rows: ScoredAnswer[]) =>
    segment(wave, dim, name, group, rows, ownBrand, hasOwnDomains);

  const groupBy = (key: (q: Question) => string) => {
    const groups = new Map<string, ScoredAnswer[]>();
    for (const answer of answers) {
      const question = byId.get(answer.qid);
      if (!question) continue;
      const value = key(question);
      groups.set(value, [...(groups.get(value) ?? []), answer]);
    }
    return groups;
  };

  const engines = new Map<string, ScoredAnswer[]>();
  for (const answer of answers) engines.set(answer.engine, [...(engines.get(answer.engine) ?? []), answer]);

  const segments: Segment[] = [
    make('전체', '전체', '', answers),
    ...[...engines].map(([engine, rows]) => make('엔진', engine, '', rows)),
    ...[...groupBy((q) => q.demand)].map(([name, rows]) => make('수요', name, '', rows)),
    ...[...groupBy((q) => q.category)].map(([name, rows]) => make('유형', name, '', rows)),
    ...[...groupBy((q) => q.product)].map(([name, rows]) =>
      make('상품', name, byId.get(rows[0]?.qid ?? '')?.group ?? '', rows),
    ),
  ];

  const brands = [...brandMentions(answers, ownBrand)]
    .filter(([brand, count]) => count > 0 || brand === ownBrand)
    .sort((a, b) => b[1] - a[1])
    .map(([brand, count]) => ({ wave, brand, count }));

  return { segments, brands };
}
