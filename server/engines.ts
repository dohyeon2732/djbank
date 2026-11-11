import Anthropic from '@anthropic-ai/sdk';
import type { EngineId } from '../src/runner/types';

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
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 180_000;
const RETRY_DELAYS_MS = [2_000, 6_000];

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/** 429, 5xx, 네트워크 오류는 두 번까지 다시 시도합니다. */
async function withRetry<T>(signal: AbortSignal, attempt: () => Promise<T>): Promise<T> {
  for (let index = 0; ; index += 1) {
    try {
      return await attempt();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[index];
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
    const retryable = response.status === 429 || response.status >= 500;
    throw new EngineError(`HTTP ${response.status}: ${detail}`, retryable);
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

/** Perplexity Sonar. 검색이 기본으로 켜져 있어 webSearch 값과 상관없이 출처가 붙습니다. */
const callPerplexity: EngineCaller = ({ question, model, key, signal }) =>
  withRetry(signal, async () => {
    const data = asRecord(
      await postJson(
        'https://api.perplexity.ai/chat/completions',
        { authorization: `Bearer ${key}` },
        { model, messages: [{ role: 'user', content: question }] },
        signal,
      ),
    );

    const message = asRecord(asRecord(asArray(data.choices)[0]).message);
    const fromResults = asArray(data.search_results).flatMap((result) => {
      const record = asRecord(result);
      const url = asString(record.url);
      return url ? [{ url, title: asString(record.title) || null }] : [];
    });
    const citations =
      fromResults.length > 0
        ? fromResults
        : asArray(data.citations).flatMap((url) => (typeof url === 'string' ? [{ url, title: null }] : []));
    const usage = asRecord(data.usage);
    return {
      text: asString(message.content),
      citations,
      model: asString(data.model) || model,
      inputTokens: asNumber(usage.prompt_tokens),
      outputTokens: asNumber(usage.completion_tokens),
    };
  });

/**
 * Claude Messages API, 공식 SDK. 웹검색은 서버 도구라 한 번 호출로 끝나지만,
 * 검색이 길어지면 pause_turn으로 멈추므로 이어서 다시 보냅니다.
 * 안전 분류기가 거절하면 서버 쪽 폴백 모델이 대신 답하고, 그 모델 이름이 기록됩니다.
 */
const callClaude: EngineCaller = async ({ question, model, key, webSearch, signal }) => {
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
  let inputTokens = 0;
  let outputTokens = 0;
  let servedBy = model;

  try {
    for (let turn = 0; turn < 4; turn += 1) {
      const response = await client.beta.messages.create(
        {
          model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
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
    if (error instanceof Anthropic.RateLimitError) throw new EngineError('호출 한도 초과(429)', false);
    if (error instanceof Anthropic.APIError) {
      throw new EngineError(`HTTP ${error.status ?? '?'}: ${error.message}`, false);
    }
    throw new EngineError(`네트워크 오류: ${(error as Error).message}`, false);
  }

  return { text: texts.join(''), citations, model: servedBy, inputTokens, outputTokens };
};

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
