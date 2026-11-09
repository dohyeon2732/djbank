import type { Answer, BrandCount, DashboardData, Question, QuestionFilters, Segment } from '../types';

export const ENGINES = ['chatgpt', 'gemini', 'claude', 'perplexity'] as const;

export const ENGINE_NAMES: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
};

export const SENTIMENT_NAMES: Record<string, string> = {
  positive: '긍정',
  neutral: '중립',
  negative: '부정',
};

export const CATEGORY_NAMES: Record<string, string> = {
  B: 'B, 카테고리 탐색',
  C: 'C, 상황과 고민',
  D: 'D, 비교',
};

export const GROUP = {
  content: '콘텐츠 대상',
  control: '통제 상품',
  unreleased: '미출시 트랙',
} as const;

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** 실행 기록 순서를 기준으로, 기록에 없는 회차는 뒤에 붙입니다. */
export function waveOrder(data: DashboardData): string[] {
  return unique([...data.runs.map((r) => r.wave), ...data.segments.map((s) => s.wave)]);
}

export function latestWave(data: DashboardData): string | null {
  return waveOrder(data).at(-1) ?? null;
}

export function answerWaves(answers: Answer[]): string[] {
  return unique(answers.map((a) => a.wave));
}

export function latestRun(data: DashboardData) {
  return data.runs.at(-1) ?? null;
}

export function segmentsOf(data: DashboardData, dim: string, wave: string | null): Segment[] {
  return data.segments.filter((s) => s.dim === dim && s.wave === wave);
}

export function findSegment(
  data: DashboardData,
  dim: string,
  name: string,
  wave: string | null,
): Segment | undefined {
  return data.segments.find((s) => s.dim === dim && s.name === name && s.wave === wave);
}

export function brandsOf(data: DashboardData, wave: string | null): BrandCount[] {
  return data.brands.filter((b) => b.wave === wave).sort((a, b) => b.count - a.count);
}

export interface GroupPoint {
  wave: string;
  name: string;
  mention_p: number;
  lo: number;
  hi: number;
  k: number;
  n: number;
}

/** 95% Wilson 구간. 파이프라인의 lo, hi와 같은 방식입니다. */
export function wilson(k: number, n: number): { lo: number; hi: number } {
  const z = 1.959964;
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

function groupPoint(data: DashboardData, name: string, wave: string): GroupPoint | null {
  const row = findSegment(data, '그룹', name, wave);
  if (row?.mention_p != null) {
    const interval = row.lo != null && row.hi != null ? { lo: row.lo, hi: row.hi } : wilson(row.k, row.n);
    return { wave, name, mention_p: row.mention_p, k: row.k, n: row.n, ...interval };
  }

  // '그룹' 행이 없는 산출물은 같은 그룹의 상품 행을 합산합니다.
  const products = segmentsOf(data, '상품', wave).filter((s) => s.group === name);
  const k = products.reduce((sum, s) => sum + s.k, 0);
  const n = products.reduce((sum, s) => sum + s.n, 0);
  if (n === 0) return null;
  return { wave, name, mention_p: k / n, k, n, ...wilson(k, n) };
}

/** 그룹 하나의 회차별 언급률. 측정값이 없는 회차는 건너뜁니다. */
export function groupSeries(data: DashboardData, name: string): GroupPoint[] {
  return waveOrder(data).flatMap((wave) => groupPoint(data, name, wave) ?? []);
}

export function groupAtLatest(data: DashboardData, name: string): GroupPoint | null {
  const wave = latestWave(data);
  return wave ? groupPoint(data, name, wave) : null;
}

/** 답변 묶음에서 DJ Bank를 언급한 엔진 수. */
export function enginesMentioning(answers: Answer[]): number {
  return ENGINES.filter((engine) => answers.some((a) => a.engine === engine && a.mention)).length;
}

export function filterQuestions(questions: Question[], filters: QuestionFilters): Question[] {
  const needle = filters.search.trim().toLowerCase();
  return questions.filter(
    (q) =>
      (!filters.group || q.group === filters.group) &&
      (!filters.demand || q.demand === filters.demand) &&
      (!filters.category || q.category === filters.category) &&
      (!needle || `${q.id} ${q.question} ${q.product}`.toLowerCase().includes(needle)),
  );
}

/** 필터에는 실제 데이터에 있는 값만 보여 줍니다. */
export function filterOptions(questions: Question[]) {
  return {
    groups: unique(questions.map((q) => q.group)),
    demands: unique(questions.map((q) => q.demand)),
    categories: unique(questions.map((q) => q.category)).sort(),
  };
}
