import type { SourceKind } from './lib/sources';

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

/** 인용 출처 집계 한 행: 한 회차에서 한 엔진이 한 사이트를 인용한 기록. */
export interface SourceRow {
  wave: string;
  engine: string;
  /** 사이트 단위 도메인. 주소를 알 수 없으면 빈 문자열. */
  domain: string;
  /** 사이트 주인(은행, 언론사 등). 규칙에 없으면 도메인 그대로. */
  owner: string;
  kind: SourceKind;
  /** 인용 수. 한 답변 안의 같은 주소는 한 번만 셉니다. */
  cites: number;
  /** 이 사이트를 인용한 답변 수. */
  answers: number;
  qids: string[];
  /** 많이 인용된 페이지 몇 개. */
  pages: { url: string; title: string | null; n: number }[];
}

export interface DashboardData {
  runs: Run[];
  segments: Segment[];
  brands: BrandCount[];
  questions: Question[];
  answers: Answer[];
  /** 서버(DB)에서 읽을 때만 채워집니다. 파일 모드에서는 빈 배열. */
  sources: SourceRow[];
}

export type DataFile = 'runs' | 'segments' | 'brands' | 'questions' | 'responses';

export interface QuestionFilters {
  demand: string;
  category: string;
  search: string;
}

export const EMPTY_FILTERS: QuestionFilters = { demand: '', category: '', search: '' };
