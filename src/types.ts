/** data/*.json 한 행의 모양. 파이프라인 출력이 바뀌면 여기부터 고칩니다. */

export interface Run {
  wave: string;
  date: string;
  planned: number;
  succeeded: number;
  failed: number;
  engines: number;
  questions: number;
  judge_version: string;
  mode: string;
}

export interface Segment {
  wave: string;
  dim: string;
  name: string;
  group: string;
  mention_p: number | null;
  lo: number | null;
  hi: number | null;
  k: number;
  n: number;
  rank_avg: number | null;
  rec_avg: number | null;
  sov: number | null;
  acc_rate: number | null;
  critical: number | null;
  sent_net: number | null;
  own_cit: number | null;
  total_cit: number | null;
  own_share: number | null;
}

export interface BrandCount {
  wave: string;
  brand: string;
  count: number;
}

export interface Question {
  id: string;
  question: string;
  category: string;
  demand: string;
  product: string;
  release: string;
  speaker: string;
  group: string;
  rationale: string;
}

/** 원본 JSON. 과거 산출물은 mention과 brands가 문자열로 직렬화돼 있을 수 있습니다. */
export interface RawAnswer {
  wave: string;
  qid: string;
  engine: string;
  rep: number;
  mention: boolean | string;
  rank: number | null;
  rec: number | null;
  sentiment: string | null;
  brands: string[] | string;
  cites: number;
  excerpt: string | null;
}

export interface Answer extends Omit<RawAnswer, 'mention' | 'brands'> {
  mention: boolean;
  brands: string[];
}

export interface DashboardData {
  runs: Run[];
  segments: Segment[];
  brands: BrandCount[];
  questions: Question[];
  answers: Answer[];
}

export type DataFile = 'runs' | 'segments' | 'brands' | 'questions' | 'responses';

export interface QuestionFilters {
  group: string;
  demand: string;
  category: string;
  search: string;
}

export const EMPTY_FILTERS: QuestionFilters = { group: '', demand: '', category: '', search: '' };
