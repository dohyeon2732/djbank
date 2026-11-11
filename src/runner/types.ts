/**
 * 실행 탭과 로컬 실행 서버(server/)가 함께 쓰는 모양.
 * API 키 값은 이 타입 어디에도 들어가지 않습니다. 화면에는 연결 여부만 내려갑니다.
 */

export const ENGINE_IDS = ['chatgpt', 'gemini', 'claude', 'perplexity'] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export interface EngineSettings {
  enabled: boolean;
  model: string;
}

export interface BrandRule {
  name: string;
  aliases: string[];
}

/** runner.config.json에 저장되는 설정. 비밀 값은 없습니다. */
export interface RunnerConfig {
  engines: Record<EngineId, EngineSettings>;
  /** 질문 하나를 엔진마다 몇 번 물을지. */
  repetitions: number;
  /** 엔진 하나에 동시에 보내는 요청 수. */
  concurrency: number;
  ownBrand: BrandRule;
  competitors: BrandRule[];
  /** 인용 출처 중 자사로 셀 도메인. 비어 있으면 자사 인용 점유율은 계산하지 않습니다. */
  ownDomains: string[];
}

export interface EngineStatus {
  id: EngineId;
  name: string;
  keyName: string;
  keyPresent: boolean;
}

export interface RunnerOverview {
  config: RunnerConfig;
  engines: EngineStatus[];
  /** 키를 읽은 파일 이름. 찾지 못하면 null. */
  envFile: string | null;
  questionCount: number;
  nextWave: string;
  /** 지금 데이터가 모의 데이터뿐이라 첫 실측 때 보관 폴더로 옮겨지는지. */
  replacesMock: boolean;
  existingWaves: string[];
  /** 연습 모드(DJBANK_RUNNER_FAKE=1). 실제 API를 호출하지 않습니다. */
  fakeMode: boolean;
}

export interface EngineTestResult {
  ok: boolean;
  model: string;
  ms: number;
  message: string;
}

export type JobState = 'idle' | 'running' | 'cancelling' | 'done' | 'cancelled' | 'failed';

export interface EngineProgress {
  id: EngineId;
  model: string;
  planned: number;
  done: number;
  failed: number;
  mentioned: number;
  inputTokens: number;
  outputTokens: number;
  lastError: string | null;
}

export interface JobStatus {
  state: JobState;
  wave: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  engines: EngineProgress[];
  message: string | null;
}
