import Anthropic from '@anthropic-ai/sdk';
import type { EngineId } from '../src/runner/types.js';

export interface Citation {
  url: string;
  title: string | null;
}

export interface EngineAnswer {
  text: string;
  citations: Citation[];
  /** 실제로 답한 모델. 요청한 이름과 다를 수 있습니다(별칭, 폴백). */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface EngineCall {
  question: string;
  model: string;
  key: string;
  /** 연결 테스트는 웹검색 없이 짧게 묻습니다. */
  webSearch: boolean;
  signal: AbortSignal;
}

export type EngineCaller = (call: EngineCall) => Promise<EngineAnswer>;

/** 실패 사유를 화면에 보여 줄 때 쓰는 오류. 키 값은 메시지에 넣지 않습니다. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** 호출 한도(429)에 걸렸을 때. 일반 오류보다 오래 기다렸다가 다시 시도합니다. */
    readonly rateLimited = false,
    /** 서버가 Retry-After로 알려 준 대기 시간. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 180_000;
const RETRY_DELAYS_MS = [2_000, 6_000];
// 호출 한도는 보통 분 단위로 풀리므로 더 길게, 한 번 더 기다립니다.
const RATE_LIMIT_DELAYS_MS = [5_000, 15_000, 30_000];
const MAX_RETRY_AFTER_MS = 60_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/** 5xx와 네트워크 오류는 두 번, 호출 한도(429)는 더 길게 세 번까지 다시 시도합니다. */
async function withRetry<T>(signal: AbortSignal, attempt: () => Promise<T>): Promise<T> {
  for (let index = 0; ; index += 1) {
    try {
      return await attempt();
    } catch (error) {
      const limited = error instanceof EngineError && error.rateLimited;
      const planned = (limited ? RATE_LIMIT_DELAYS_MS : RETRY_DELAYS_MS)[index];
      const asked = limited ? error.retryAfterMs : null;
      const delay = planned === undefined ? undefined : Math.min(MAX_RETRY_AFTER_MS, Math.max(planned, asked ?? 0));
      const retryable = error instanceof EngineError ? error.retryable : !signal.aborted;
      if (!retryable || delay === undefined || signal.aborted) throw error;
      await sleep(delay, signal);
    }
  }
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new EngineError(`네트워크 오류: ${(error as Error).message}`, true);
  }

  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string };
      const message = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
      if (message) detail = message;
    } catch {
      // 본문이 JSON이 아니면 앞부분만 보여 줍니다.
    }
    const limited = response.status === 429;
    const seconds = Number(response.headers.get('retry-after'));
    throw new EngineError(
      `HTTP ${response.status}: ${detail}`,
      limited || response.status >= 500,
      limited,
      limited && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null,
    );
  }
  return JSON.parse(text) as unknown;
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** OpenAI Responses API. 웹검색 도구를 켜면 답변 안에 url_citation 주석이 붙습니다. */
const callChatGpt: EngineCaller = ({ question, model, key, webSearch, signal }) =>
  withRetry(signal, async () => {
    const data = asRecord(
      await postJson(
        'https://api.openai.com/v1/responses',
        { authorization: `Bearer ${key}` },
        {
          model,
          input: question,
          ...(webSearch && {
            tools: [{ type: 'web_search', user_location: { type: 'approximate', country: 'KR' } }],
          }),
        },
        signal,
      ),
    );

    const texts: string[] = [];
    const citations: Citation[] = [];
    for (const item of asArray(data.output).map(asRecord)) {
      if (item.type !== 'message') continue;
      for (const part of asArray(item.content).map(asRecord)) {
        if (part.type !== 'output_text') continue;
        texts.push(asString(part.text));
        for (const note of asArray(part.annotations).map(asRecord)) {
          if (note.type === 'url_citation') {
            citations.push({ url: asString(note.url), title: asString(note.title) || null });
          }
        }
      }
    }
    const usage = asRecord(data.usage);
    return {
      text: texts.join('\n'),
      citations,
      model: asString(data.model) || model,
      inputTokens: asNumber(usage.input_tokens),
      outputTokens: asNumber(usage.output_tokens),
    };
  });

/** Gemini API. 출처는 groundingMetadata에 들어오고, title에 출처 도메인이 담깁니다. */
const callGemini: EngineCaller = ({ question, model, key, webSearch, signal }) =>
  withRetry(signal, async () => {
    const data = asRecord(
      await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': key },
        {
          contents: [{ role: 'user', parts: [{ text: question }] }],
          ...(webSearch && { tools: [{ google_search: {} }] }),
        },
        signal,
      ),
    );

    const candidate = asRecord(asArray(data.candidates)[0]);
    const text = asArray(asRecord(candidate.content).parts)
      .map((part) => asString(asRecord(part).text))
      .join('');
    const citations = asArray(asRecord(candidate.groundingMetadata).groundingChunks).flatMap((chunk) => {
      const web = asRecord(asRecord(chunk).web);
      const url = asString(web.uri);
      return url ? [{ url, title: asString(web.title) || null }] : [];
    });
    if (!text && candidate.finishReason) {
      throw new EngineError(`빈 답변 (finishReason: ${asString(candidate.finishReason)})`, false);
    }
    const usage = asRecord(data.usageMetadata);
    return {
      text,
      citations,
      model: asString(data.modelVersion) || model,
      inputTokens: asNumber(usage.promptTokenCount),
      outputTokens: asNumber(usage.candidatesTokenCount),
    };
  });

/**
 * Perplexity Agent API(/v1/agent). 예전 Sonar의 /chat/completions는 폐기됐습니다.
 * 설정의 model 칸에는 effort 단계(fast, low, medium, high ...)를 적습니다. 단계마다 웹검색이 기본으로 켜져 있어,
 * 연결 테스트처럼 검색이 필요 없을 때는 max_tool_calls: 0으로 끕니다.
 */
const callPerplexity: EngineCaller = ({ question, model, key, webSearch, signal }) =>
  withRetry(signal, async () => {
    const effort = !model || model.startsWith('sonar') ? 'fast' : model;
    const data = asRecord(
      await postJson(
        'https://api.perplexity.ai/v1/agent',
        { authorization: `Bearer ${key}` },
        { effort, input: question, ...(!webSearch && { max_tool_calls: 0 }) },
        signal,
      ),
    );

    const texts: string[] = [];
    const citations: Citation[] = [];
    for (const item of asArray(data.output).map(asRecord)) {
      if (item.type === 'message') {
        for (const part of asArray(item.content).map(asRecord)) {
          if (part.type === 'output_text') texts.push(asString(part.text));
        }
      } else if (item.type === 'search_results') {
        for (const result of asArray(item.results).map(asRecord)) {
          const url = asString(result.url);
          if (url) citations.push({ url, title: asString(result.title) || null });
        }
      }
    }
    const usage = asRecord(data.usage);
    return {
      text: texts.join('\n'),
      citations,
      model: [asString(data.effort), asString(data.model)].filter(Boolean).join(', ') || effort,
      inputTokens: asNumber(usage.input_tokens),
      outputTokens: asNumber(usage.output_tokens),
    };
  });

/**
 * Claude Messages API, 공식 SDK. 웹검색은 서버 도구라 한 번 호출로 끝나지만,
 * 검색이 길어지면 pause_turn으로 멈추므로 이어서 다시 보냅니다.
 * 안전 분류기가 거절하면 서버 쪽 폴백 모델이 대신 답하고, 그 모델 이름이 기록됩니다.
 */
const askClaude: EngineCaller = async ({ question, model, key, webSearch, signal }) => {
  // 주소를 고정해, 셸에 ANTHROPIC_BASE_URL 같은 환경변수가 있어도 키가 공식 API로만 갑니다.
  const client = new Anthropic({
    apiKey: key,
    authToken: null,
    baseURL: 'https://api.anthropic.com',
    maxRetries: 2,
    timeout: REQUEST_TIMEOUT_MS,
  });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: question }];
  const texts: string[] = [];
  const citations: Citation[] = [];
  // 인용 표시 없이 검색만 한 경우에 쓰는, 검색해서 가져온 결과 목록.
  const searched: Citation[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let servedBy = model;
  // Haiku는 서버 쪽 폴백을 지원하지 않아, 폴백 옵션을 보내면 요청이 거절됩니다.
  const fallback = !/haiku/i.test(model);

  try {
    for (let turn = 0; turn < 4; turn += 1) {
      const response = await client.beta.messages.create(
        {
          model,
          max_tokens: 16000,
          ...(fallback && { betas: ['server-side-fallback-2026-07-01' as const], fallbacks: 'default' as const }),
          output_config: { effort: webSearch ? 'medium' : 'low' },
          ...(webSearch && {
            tools: [
              {
                type: 'web_search_20260209',
                name: 'web_search',
                max_uses: 5,
                user_location: { type: 'approximate', country: 'KR', timezone: 'Asia/Seoul' },
              },
            ],
          }),
          messages,
        },
        { signal },
      );

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      servedBy = response.model;

      if (response.stop_reason === 'refusal') {
        throw new EngineError(
          `답변 거절 (${response.stop_details?.category ?? '분류 없음'})`,
          false,
        );
      }

      for (const block of response.content) {
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const result of block.content) {
            if (result.type === 'web_search_result') searched.push({ url: result.url, title: result.title });
          }
        }
        if (block.type !== 'text') continue;
        texts.push(block.text);
        for (const citation of block.citations ?? []) {
          if (citation.type === 'web_search_result_location') {
            citations.push({ url: citation.url, title: citation.title });
          }
        }
      }

      if (response.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: response.content });
    }
  } catch (error) {
    if (error instanceof EngineError || signal.aborted) throw error;
    if (error instanceof Anthropic.AuthenticationError) throw new EngineError('키가 올바르지 않습니다', false);
    if (error instanceof Anthropic.NotFoundError) throw new EngineError(`모델을 찾을 수 없습니다: ${model}`, false);
    if (error instanceof Anthropic.RateLimitError) throw new EngineError('호출 한도 초과(429)', true, true);
    if (error instanceof Anthropic.APIError) {
      throw new EngineError(`HTTP ${error.status ?? '?'}: ${error.message}`, false);
    }
    throw new EngineError(`네트워크 오류: ${(error as Error).message}`, false);
  }

  // 답변에 인용 표시가 하나도 없으면, 검색해서 읽은 결과를 출처로 남깁니다.
  return {
    text: texts.join(''),
    citations: citations.length > 0 ? citations : searched,
    model: servedBy,
    inputTokens,
    outputTokens,
  };
};

/** 호출 한도(429)에 걸리면 기다렸다가 처음부터 다시 묻습니다. */
const callClaude: EngineCaller = (args) => withRetry(args.signal, () => askClaude(args));

/**
 * 연습 실행. DJBANK_RUNNER_FAKE=1로 서버를 켜면 실제 API 대신 이 함수가 답합니다.
 * 화면과 저장 흐름을 요금 없이 확인할 때만 씁니다.
 */
const callFake: EngineCaller = async ({ question, model, signal }) => {
  await sleep(150 + Math.random() * 350, signal);
  const hit = Math.random() < 0.55;
  const text = hit
    ? `「${question}」에 대해서는 IBK기업은행과 DJ Bank를 비교해 보세요. DJ Bank는 더존 ERP와 연동됩니다.`
    : `「${question}」라면 KB국민은행이나 신한은행 상품을 먼저 살펴보세요.`;
  return {
    text,
    citations: [{ url: hit ? 'https://www.djbank.example/products' : 'https://news.example/finance', title: null }],
    model: `${model} (연습)`,
    inputTokens: 40,
    outputTokens: 120,
  };
};

export const isFakeMode = () => process.env.DJBANK_RUNNER_FAKE === '1';

export const ENGINES: Record<EngineId, { name: string; call: EngineCaller }> = {
  chatgpt: { name: 'ChatGPT', call: callChatGpt },
  gemini: { name: 'Gemini', call: callGemini },
  claude: { name: 'Claude', call: callClaude },
  perplexity: { name: 'Perplexity', call: callPerplexity },
};

export function callerFor(engine: EngineId): EngineCaller {
  return isFakeMode() ? callFake : ENGINES[engine].call;
}
