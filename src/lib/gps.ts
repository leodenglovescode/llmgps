import {
  type ChatMessage,
  type ModelSelection,
  GPS_CONSENSUS_CHECK_PROMPT,
  GPS_OPINION_SUFFIX,
  GPS_SYNTHESIS_PROMPT,
  getProvider,
} from "@/lib/llm";
import { type CompressionConfig, type WebSearchConfig } from "@/lib/app-config";
import { logError } from "@/lib/logger";

import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import nodeFetch from "node-fetch";

const PROVIDER_REQUEST_TIMEOUT_MS = 120_000;

async function proxyFetch(url: string, options: globalThis.RequestInit, proxyUrl?: string) {
  if (!proxyUrl) {
    return fetch(url, options);
  }

  const agent = proxyUrl.startsWith("socks")
    ? new SocksProxyAgent(proxyUrl)
    : new HttpsProxyAgent(proxyUrl);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return nodeFetch(url, { ...options, agent } as any) as unknown as Response;
}

export type ApiKeyMap = Partial<Record<ModelSelection["providerId"], string>>;

export type ClientGpsRequestPayload = {
  compressionConfig?: CompressionConfig | null;
  compressionModel?: ModelSelection | null;
  gpsMode: boolean;
  debateMode?: boolean;
  messages: ChatMessage[];
  previousCompressedContext?: string | null;
  responderModels: ModelSelection[];
  searchQueryModel?: ModelSelection | null;
  synthesizerModel?: ModelSelection | null;
  webSearchEnabled?: boolean;
};

export type GpsExecutionPayload = ClientGpsRequestPayload & {
  apiKeys: ApiKeyMap;
  customEndpointBaseUrl?: string;
  ollamaBaseUrl?: string;
  ollamaBypassProxy?: boolean;
  proxyUrl?: string;
  webSearchConfig?: WebSearchConfig;
};

export type ModelOpinion = ModelSelection & {
  content: string;
};

export type ModelFailure = ModelSelection & {
  error: string;
};

export type GpsResponsePayload = {
  consensus: string;
  failures: ModelFailure[];
  mode: "gps" | "debate" | "single";
  opinions: ModelOpinion[];
  responderCount: number;
};

type OpenAICompatibleResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type AnthropicResponse = {
  content?: Array<{
    text?: string;
    type?: string;
  }>;
  error?: {
    message?: string;
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

export class GpsError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GpsError";
    this.status = status;
  }
}

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
};

type BraveSearchResponse = {
  web?: { results?: BraveWebResult[] };
};

type TavilySearchResult = {
  title?: string;
  url?: string;
  content?: string;
};

type TavilySearchResponse = {
  results?: TavilySearchResult[];
};

type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

const WEB_SEARCH_TIMEOUT_MS = 15_000;

async function fetchWebSearchResults(
  query: string,
  config: WebSearchConfig,
  proxyUrl?: string,
): Promise<WebSearchResult[]> {
  if (config.provider === "tavily") {
    const response = await proxyFetch(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: config.apiKey,
          query,
          max_results: config.maxResults,
          search_depth: "basic",
        }),
        signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
      },
      proxyUrl,
    );

    if (!response.ok) {
      throw new GpsError(`Tavily search failed (${response.status}).`, 502);
    }

    const data = (await response.json()) as TavilySearchResponse;
    return (data.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.content ?? "",
    })).filter((r) => r.snippet);
  }

  // Brave Search
  const params = new URLSearchParams({ q: query, count: String(config.maxResults) });
  const response = await proxyFetch(
    `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": config.apiKey,
      },
      signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
    },
    proxyUrl,
  );

  if (!response.ok) {
    throw new GpsError(`Brave search failed (${response.status}).`, 502);
  }

  const data = (await response.json()) as BraveSearchResponse;
  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  })).filter((r) => r.snippet);
}

function buildSearchContextBlock(results: WebSearchResult[]): string {
  if (results.length === 0) return "";

  const lines = results.map(
    (r, i) => `${i + 1}. ${r.title} (${r.url}): ${r.snippet}`,
  );

  return `[Web Search Results — ${new Date().toISOString().slice(0, 10)}]\n${lines.join("\n")}`;
}

const SEARCH_QUERY_GENERATION_PROMPT = `You are a search query generator. Given the user's message, produce focused web search queries to gather relevant, up-to-date information.

Rules:
- Output ONLY a JSON array of query strings — no explanation, preamble, or extra text
- Maximum 5 queries
- Each query must be concise (under 10 words), specific, and independently searchable
- Cover different aspects of the topic

Example output: ["Claude AI model comparison 2025", "LLM benchmark results latest", "transformer architecture improvements"]`;

async function generateSearchQueries(
  userMessage: string,
  searchQueryModel: ModelSelection,
  apiKeys: ApiKeyMap,
  ollamaBaseUrl?: string,
  proxyUrl?: string,
  customEndpointBaseUrl?: string,
): Promise<string[]> {
  try {
    const apiKey = getRequiredProviderSecret(searchQueryModel, apiKeys);
    const response = await sendModelMessage(
      searchQueryModel,
      apiKey,
      [{ role: "user", content: `${SEARCH_QUERY_GENERATION_PROMPT}\n\nUser message: ${userMessage.slice(0, 800)}` }],
      ollamaBaseUrl,
      proxyUrl,
      customEndpointBaseUrl,
    );
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        const queries = (parsed as unknown[])
          .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
          .map((q) => q.trim())
          .slice(0, 5);
        if (queries.length > 0) return queries;
      }
    }
  } catch {
    // fall through to default
  }
  return [userMessage.slice(0, 200)];
}

async function maybeInjectWebSearch(
  messages: ChatMessage[],
  config: WebSearchConfig | undefined,
  proxyUrl?: string,
  searchQueryModel?: ModelSelection | null,
  apiKeys?: ApiKeyMap,
  ollamaBaseUrl?: string,
  customEndpointBaseUrl?: string,
): Promise<{ messages: ChatMessage[]; searched: boolean; results: WebSearchResult[]; queries: string[] }> {
  if (!config?.enabled || !config.apiKey?.trim()) {
    return { messages, searched: false, results: [], queries: [] };
  }

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) {
    return { messages, searched: false, results: [], queries: [] };
  }

  try {
    // Generate queries via model, or fall back to raw user message
    const queries: string[] = searchQueryModel && apiKeys
      ? await generateSearchQueries(
          lastUserMessage.content,
          searchQueryModel,
          apiKeys,
          ollamaBaseUrl,
          proxyUrl,
          customEndpointBaseUrl,
        )
      : [lastUserMessage.content.slice(0, 200)];

    // Search each query and collect results (deduplicated by URL)
    const seenUrls = new Set<string>();
    const allResults: WebSearchResult[] = [];

    for (const query of queries) {
      try {
        const results = await fetchWebSearchResults(query, config, proxyUrl);
        for (const r of results) {
          if (r.url && !seenUrls.has(r.url)) {
            seenUrls.add(r.url);
            allResults.push(r);
          }
        }
      } catch {
        // skip failed queries
      }
    }

    const block = buildSearchContextBlock(allResults);
    if (!block) {
      return { messages, searched: false, results: [], queries };
    }

    return {
      messages: [
        { role: "user" as const, content: block },
        { role: "assistant" as const, content: "Thank you for the web search context. I will use these results to inform my response." },
        ...messages,
      ],
      searched: true,
      results: allResults,
      queries,
    };
  } catch {
    return { messages, searched: false, results: [], queries: [] };
  }
}

function buildOpinionMessages(messages: ChatMessage[]) {
  const lastUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === "user")?.index;

  if (lastUserIndex === undefined) {
    throw new GpsError("A user message is required before sending a GPS request.", 400);
  }

  return messages.map((message, index) => {
    if (index !== lastUserIndex || message.role !== "user") {
      return message;
    }

    return {
      ...message,
      content: `${message.content}\n\n---\n${GPS_OPINION_SUFFIX}`,
    };
  });
}

function getOpenAICompatibleBaseUrl(providerId: ModelSelection["providerId"], customEndpointBaseUrl?: string) {
  switch (providerId) {
    case "openai":
      return "https://api.openai.com/v1/chat/completions";
    case "openrouter":
      return "https://openrouter.ai/api/v1/chat/completions";
    case "deepseek":
      return "https://api.deepseek.com/chat/completions";
    case "xai":
      return "https://api.x.ai/v1/chat/completions";
    case "kimi":
      return "https://api.moonshot.cn/v1/chat/completions";
    case "qwen":
      return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    case "mistral":
      return "https://api.mistral.ai/v1/chat/completions";
    case "zhipu":
      return "https://open.bigmodel.cn/api/paas/v4/chat/completions";
    case "custom": {
      const url = customEndpointBaseUrl?.trim();
      if (!url) throw new GpsError("Custom endpoint URL is not configured in Settings.", 400);
      return url;
    }
    default:
      throw new GpsError(`Provider ${providerId} is not OpenAI-compatible.`, 500);
  }
}

function getRequiredProviderSecret(model: ModelSelection, apiKeys: ApiKeyMap) {
  if (model.providerId === "ollama") {
    return null;
  }

  const apiKey = apiKeys[model.providerId]?.trim();

  if (!apiKey) {
    throw new GpsError(`Missing API key for ${model.providerId}.`, 400);
  }

  return apiKey;
}

async function parseError(response: Response) {
  try {
    const raw = await response.text();

    if (!raw.trim()) {
      return response.statusText;
    }

    try {
      const json = JSON.parse(raw) as { error?: { message?: string }; message?: string };
      return json.error?.message || json.message || raw || response.statusText;
    } catch {
      return raw;
    }
  } catch {
    return response.statusText;
  }
}

function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "The provider request failed.";

  // Node.js native fetch wraps the real cause inside error.cause
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`;
  }

  return error.message;
}

function normalizeProviderError(error: unknown) {
  if (error instanceof GpsError) {
    return error;
  }

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new GpsError(
      `Provider request timed out after ${Math.round(PROVIDER_REQUEST_TIMEOUT_MS / 1000)}s.`,
      504,
    );
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new GpsError(
      `Provider request timed out after ${Math.round(PROVIDER_REQUEST_TIMEOUT_MS / 1000)}s.`,
      504,
    );
  }

  logError("provider", extractErrorMessage(error), error);
  return new GpsError(extractErrorMessage(error), 500);
}

async function sendOpenAICompatibleMessage(
  model: ModelSelection,
  apiKey: string,
  messages: ChatMessage[],
  proxyUrl?: string,
  customEndpointBaseUrl?: string,
) {
  try {
    const response = await proxyFetch(getOpenAICompatibleBaseUrl(model.providerId, customEndpointBaseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(model.providerId === "openrouter"
          ? {
              "HTTP-Referer": "https://llmgps.local",
              "X-Title": "llmgps",
            }
          : {}),
      },
      body: JSON.stringify({
        model: model.modelId,
        messages,
        temperature: 0.6,
      }),
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
    }, proxyUrl);

    if (!response.ok) {
      throw new GpsError(await parseError(response), response.status);
    }

    const payload = (await response.json()) as OpenAICompatibleResponse;
    const content = payload.choices?.[0]?.message?.content;

    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => part.text)
        .filter(Boolean)
        .join("\n")
        .trim();
    }

    throw new GpsError(payload.error?.message || "The provider returned an empty response.", 502);
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

async function sendAnthropicMessage(
  model: ModelSelection,
  apiKey: string,
  messages: ChatMessage[],
  proxyUrl?: string,
) {
  try {
    const response = await proxyFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model.modelId,
        max_tokens: 1200,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
    }, proxyUrl);

    if (!response.ok) {
      throw new GpsError(await parseError(response), response.status);
    }

    const payload = (await response.json()) as AnthropicResponse;
    const content =
      payload.content
        ?.filter((entry) => entry.type === "text")
        .map((entry) => entry.text)
        .filter(Boolean)
        .join("\n")
        .trim() || "";

    if (!content) {
      throw new GpsError(payload.error?.message || "Anthropic returned an empty response.", 502);
    }

    return content;
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

async function sendGeminiMessage(
  model: ModelSelection,
  apiKey: string,
  messages: ChatMessage[],
  proxyUrl?: string,
) {
  try {
    const response = await proxyFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: messages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
          generationConfig: {
            temperature: 0.6,
          },
        }),
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      },
      proxyUrl
    );

    if (!response.ok) {
      throw new GpsError(await parseError(response), response.status);
    }

    const payload = (await response.json()) as GeminiResponse;
    const content =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .filter(Boolean)
        .join("\n")
        .trim() || "";

    if (!content) {
      throw new GpsError(payload.error?.message || "Gemini returned an empty response.", 502);
    }

    return content;
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

async function sendOllamaMessage(
  model: ModelSelection,
  messages: ChatMessage[],
  ollamaBaseUrl?: string,
  proxyUrl?: string,
) {
  try {
    if (!ollamaBaseUrl?.trim()) {
      throw new GpsError("Ollama is not enabled in Settings.", 400);
    }

    const normalizedBaseUrl = ollamaBaseUrl.replace(/\/$/, "");
    const response = await proxyFetch(
      `${normalizedBaseUrl}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model.modelId,
          messages,
          stream: false,
        }),
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      },
      proxyUrl,
    );

    if (!response.ok) {
      throw new GpsError(await parseError(response), response.status);
    }

    const payload = (await response.json()) as {
      error?: string;
      message?: {
        content?: string;
      };
    };
    const content = payload.message?.content?.trim() || "";

    if (!content) {
      throw new GpsError(payload.error || "Ollama returned an empty response.", 502);
    }

    return content;
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

async function sendModelMessage(
  model: ModelSelection,
  apiKey: string | null,
  messages: ChatMessage[],
  ollamaBaseUrl?: string,
  proxyUrl?: string,
  customEndpointBaseUrl?: string,
) {
  const provider = getProvider(model.providerId);

  if (!provider) {
    throw new GpsError(`Unknown provider: ${model.providerId}.`, 400);
  }

  switch (provider.requestShape) {
    case "openai-compatible":
      return sendOpenAICompatibleMessage(model, apiKey || "", messages, proxyUrl, customEndpointBaseUrl);
    case "anthropic":
      return sendAnthropicMessage(model, apiKey || "", messages, proxyUrl);
    case "gemini":
      return sendGeminiMessage(model, apiKey || "", messages, proxyUrl);
    case "ollama":
      return sendOllamaMessage(model, messages, ollamaBaseUrl, proxyUrl);
    default:
      throw new GpsError(`Unsupported request shape for ${provider.name}.`, 500);
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length * 0.25);
}

async function checkConsensus(
  opinions: ModelOpinion[],
  synthesizerModel: ModelSelection,
  apiKey: string | null,
  ollamaBaseUrl: string | undefined,
  proxyUrl: string | undefined,
  customEndpointBaseUrl?: string,
): Promise<boolean> {
  const opinionsBlock = opinions
    .map((o) => `[${o.label || o.modelId}]:\n${o.content}`)
    .join("\n\n---\n\n");

  const result = await sendModelMessage(
    synthesizerModel,
    apiKey,
    [{ role: "user", content: `${GPS_CONSENSUS_CHECK_PROMPT}\n\n${opinionsBlock}` }],
    ollamaBaseUrl,
    proxyUrl,
    customEndpointBaseUrl,
  );

  return result.trim().toUpperCase().startsWith("YES");
}

function buildCompressionMessage(contextMessages: ChatMessage[], opinions: ModelOpinion[]): string {
  const lastUserMsg = [...contextMessages].reverse().find((m) => m.role === "user")?.content ?? "";

  const opinionsBlock = opinions
    .map((o) => `[${o.label || o.modelId} | ${o.providerId}]\n${o.content}`)
    .join("\n\n---\n\n");

  return `You are a research synthesis assistant. Compress the following AI debate into a dense, structured summary.

Original question/context:
${lastUserMsg.slice(0, 800)}

Model responses and debate:
${opinionsBlock}

Produce a compressed summary with these sections:
**Consensus**: Points where models agree
**Key Disagreements**: Main points of contention with specifics
**Supporting Evidence**: Most compelling arguments cited
**Open Questions**: What remains unresolved

Be dense and factual. Preserve technical detail. Eliminate redundancy.`;
}

function buildSynthesisMessage(messages: ChatMessage[], opinions: ModelOpinion[]) {
  const transcript = messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");

  const opinionsBlock = opinions
    .map(
      (opinion) =>
        `[${opinion.label} | ${opinion.providerId} | ${opinion.modelId}]\n${opinion.content}`,
    )
    .join("\n\n");

  return `${GPS_SYNTHESIS_PROMPT}
Original conversation:
${transcript}

Model opinions:
${opinionsBlock}

Return one direct final answer to the user.`;
}

function ensureValidRequest(payload: ClientGpsRequestPayload) {
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    throw new GpsError("At least one message is required.", 400);
  }

  if (!Array.isArray(payload.responderModels) || payload.responderModels.length === 0) {
    throw new GpsError("Choose at least one responder model.", 400);
  }

  if (payload.responderModels.length > 5) {
    throw new GpsError("You can only select up to 5 responder models.", 400);
  }

  if (payload.gpsMode && !payload.synthesizerModel) {
    throw new GpsError("Choose a synthesizer model before using GPS Mode.", 400);
  }
}

export async function runGpsWorkflow(
  payload: GpsExecutionPayload,
): Promise<GpsResponsePayload> {
  ensureValidRequest(payload);

  const proxyFor = (model: ModelSelection) =>
    payload.ollamaBypassProxy && model.providerId === "ollama" ? undefined : payload.proxyUrl;

  const cleanMessages = payload.messages
    .filter(
      (message): message is ChatMessage =>
        Boolean(message?.content?.trim()) &&
        (message.role === "user" || message.role === "assistant"),
    )
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));

  const { messages: enrichedMessages } = await maybeInjectWebSearch(
    cleanMessages,
    payload.webSearchConfig,
    payload.proxyUrl,
    payload.searchQueryModel,
    payload.apiKeys,
    payload.ollamaBaseUrl,
    payload.customEndpointBaseUrl,
  );

  const primaryModel = payload.responderModels[0];

  if (!payload.gpsMode && !payload.debateMode) {
    const apiKey = getRequiredProviderSecret(primaryModel, payload.apiKeys);
    const content = await sendModelMessage(
      primaryModel,
      apiKey,
      enrichedMessages,
      payload.ollamaBaseUrl,
      proxyFor(primaryModel),
      payload.customEndpointBaseUrl,
    );

    return {
      consensus: content,
      failures: [],
      mode: "single",
      opinions: [{ ...primaryModel, content }],
      responderCount: 1,
    };
  }

  const opinionMessages = buildOpinionMessages(enrichedMessages);
  const settled = await Promise.allSettled(
    payload.responderModels.map(async (model) => {
      const apiKey = getRequiredProviderSecret(model, payload.apiKeys);
      const content = await sendModelMessage(
        model,
        apiKey,
        opinionMessages,
        payload.ollamaBaseUrl,
        proxyFor(model),
        payload.customEndpointBaseUrl,
      );

      return {
        ...model,
        content,
      } satisfies ModelOpinion;
    }),
  );

  const opinions: ModelOpinion[] = [];
  const failures: ModelFailure[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      opinions.push(result.value);
      return;
    }

    const model = payload.responderModels[index];
    failures.push({
      ...model,
      error:
        result.reason instanceof Error ? result.reason.message : "The provider request failed.",
    });
  });

  if (opinions.length === 0) {
    throw new GpsError(
      failures[0]?.error || "All responder models failed to produce an answer.",
      502,
    );
  }

  const synthesizerModel = payload.synthesizerModel;

  if (!synthesizerModel) {
    throw new GpsError("Choose a synthesizer model before using GPS Mode.", 400);
  }

  const synthesizerApiKey = getRequiredProviderSecret(synthesizerModel, payload.apiKeys);
  const consensus = await sendModelMessage(
    synthesizerModel,
    synthesizerApiKey,
    [
      {
        role: "user",
        content: buildSynthesisMessage(cleanMessages, opinions),
      },
    ],
    payload.ollamaBaseUrl,
    proxyFor(synthesizerModel),
    payload.customEndpointBaseUrl,
  );

  return {
    consensus,
    failures,
    mode: "gps",
    opinions,
    responderCount: opinions.length,
  };
}

export type GpsStreamEvent = 
  | { type: 'progress'; message: string }
  | { type: 'result'; payload: GpsResponsePayload }
  | { type: 'error'; error: string }
  | { type: 'opinion'; model: string; content: string; phase: 'initial' | 'debate' }
  | { type: 'compressed'; compressedContext: string; originalEstimate: number; compressedEstimate: number }
  | { type: 'webSearchResults'; results: WebSearchResult[] }
  | { type: 'synthesisError'; error: string; partialPayload: GpsResponsePayload };

export async function* runGpsWorkflowStreaming(
  payload: GpsExecutionPayload,
): AsyncGenerator<GpsStreamEvent, void, unknown> {
  ensureValidRequest(payload);

  const proxyFor = (model: ModelSelection) =>
    payload.ollamaBypassProxy && model.providerId === "ollama" ? undefined : payload.proxyUrl;

  const cleanMessages = payload.messages
    .filter(
      (message): message is ChatMessage =>
        Boolean(message?.content?.trim()) &&
        (message.role === "user" || message.role === "assistant"),
    )
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));

  // Rolling context: substitute previous compressed summary + new question
  const rollingActive =
    payload.compressionConfig?.rollingContext === true &&
    typeof payload.previousCompressedContext === "string" &&
    payload.previousCompressedContext.trim().length > 0;

  const contextMessages: ChatMessage[] = rollingActive
    ? (() => {
        const lastUserMsg = [...cleanMessages].reverse().find((m) => m.role === "user")?.content ?? "";
        return [
          { role: "user" as const, content: `[Context from previous research rounds]\n\n${payload.previousCompressedContext!.trim()}` },
          { role: "assistant" as const, content: "Understood. I have reviewed the previous research context and am ready to continue." },
          { role: "user" as const, content: lastUserMsg },
        ];
      })()
    : cleanMessages;

  if (payload.webSearchConfig?.enabled && payload.webSearchConfig.apiKey?.trim()) {
    yield { type: 'progress', message: payload.searchQueryModel
      ? `Generating search queries with ${payload.searchQueryModel.label || payload.searchQueryModel.modelId}...`
      : 'Searching the web...' };
  }

  const { messages: enrichedMessages, searched, results: webResults, queries: searchQueries } = await maybeInjectWebSearch(
    contextMessages,
    payload.webSearchConfig,
    payload.proxyUrl,
    payload.searchQueryModel,
    payload.apiKeys,
    payload.ollamaBaseUrl,
    payload.customEndpointBaseUrl,
  );

  if (searched) {
    if (searchQueries.length > 1) {
      yield { type: 'progress', message: `Searched ${searchQueries.length} queries, ${webResults.length} results injected.` };
    } else {
      yield { type: 'progress', message: 'Web search results injected.' };
    }
    yield { type: 'webSearchResults', results: webResults };
  }

  const primaryModel = payload.responderModels[0];

  if (!payload.gpsMode && !payload.debateMode) {
    const apiKey = getRequiredProviderSecret(primaryModel, payload.apiKeys);

    yield { type: 'progress', message: `Trying to access ${(primaryModel.label || primaryModel.modelId)} API...` };
    yield { type: 'progress', message: `Sending prompt to ${(primaryModel.label || primaryModel.modelId)}...` };

    let content: string;
    try {
      content = await sendModelMessage(
        primaryModel,
        apiKey,
        enrichedMessages,
        payload.ollamaBaseUrl,
        proxyFor(primaryModel),
        payload.customEndpointBaseUrl,
      );
    } catch (singleModelError) {
      const normalized = normalizeProviderError(singleModelError);
      throw new GpsError(
        `${primaryModel.label || primaryModel.modelId}: ${normalized.message}`,
        normalized.status,
      );
    }
    yield {
      type: 'result',
      payload: {
        consensus: content,
        failures: [],
        mode: "single",
        opinions: [{ ...primaryModel, content }],
        responderCount: 1,
      }
    };
    return;
  }

  const opinionMessages = buildOpinionMessages(enrichedMessages);
  
  yield { type: 'progress', message: 'Sending prompt to responder models...' };

  const initialOpinions: ModelOpinion[] = [];
  const failures: ModelFailure[] = [];

  // First Round
  const firstRoundSettled = await Promise.allSettled(
    payload.responderModels.map(async (model) => {
      const apiKey = getRequiredProviderSecret(model, payload.apiKeys);
      const content = await sendModelMessage(
        model,
        apiKey,
        opinionMessages,
        payload.ollamaBaseUrl,
        proxyFor(model),
        payload.customEndpointBaseUrl,
      );
      return { ...model, content } satisfies ModelOpinion;
    }),
  );

  firstRoundSettled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      initialOpinions.push(result.value);
    } else {
      const model = payload.responderModels[index];
      failures.push({
        ...model,
        error: result.reason instanceof Error ? result.reason.message : "The provider request failed.",
      });
    }
  });

  if (initialOpinions.length === 0) {
    throw new GpsError(
      failures[0]?.error || "All responder models failed to produce an answer.",
      502,
    );
  }

  for (const op of initialOpinions) {
    yield { type: 'opinion', model: op.label || op.modelId, content: op.content, phase: 'initial' };
  }

  // Hoist synthesizerModel — needed for consensus checks inside the debate loop
  const synthesizerModel = payload.synthesizerModel;
  if (!synthesizerModel) {
    throw new GpsError("Choose a synthesizer model before using GPS Mode.", 400);
  }

  let finalOpinions = initialOpinions;

  // Debate loop — consensus-gated, max 2 rounds
  const MAX_DEBATE_ROUNDS = 2;
  if (payload.debateMode && initialOpinions.length > 1) {
    const synthApiKey = getRequiredProviderSecret(synthesizerModel, payload.apiKeys);
    let currentOpinions = initialOpinions;
    let currentEnrichedMessages = enrichedMessages;

    for (let round = 1; round <= MAX_DEBATE_ROUNDS; round++) {
      // Consensus check — ask synthesizer whether models already agree
      yield { type: 'progress', message: 'Checking for consensus...' };
      let hasConsensus = false;
      try {
        hasConsensus = await checkConsensus(
          currentOpinions,
          synthesizerModel,
          synthApiKey,
          payload.ollamaBaseUrl,
          proxyFor(synthesizerModel),
          payload.customEndpointBaseUrl,
        );
      } catch {
        // If the check itself fails, conservatively assume no consensus
        hasConsensus = false;
      }

      if (hasConsensus) {
        yield { type: 'progress', message: 'Consensus reached. Proceeding to synthesis...' };
        break;
      }

      yield { type: 'progress', message: `Consensus not reached — starting debate round ${round}...` };

      // Re-run web search before round 2 to give models fresh evidence
      if (round === 2 && payload.webSearchConfig?.enabled && payload.webSearchConfig.apiKey?.trim()) {
        yield { type: 'progress', message: 'Re-running web search for round 2...' };
        try {
          const { messages: refreshedMessages, results: refreshedResults } = await maybeInjectWebSearch(
            contextMessages,
            payload.webSearchConfig,
            payload.proxyUrl,
            payload.searchQueryModel,
            payload.apiKeys,
            payload.ollamaBaseUrl,
            payload.customEndpointBaseUrl,
          );
          if (refreshedResults.length > 0) {
            currentEnrichedMessages = refreshedMessages;
            yield { type: 'webSearchResults', results: refreshedResults };
          }
        } catch {
          // Non-fatal — continue with previous search context
        }
      }

      const roundSettled = await Promise.allSettled(
        currentOpinions.map(async (model) => {
          const apiKey = getRequiredProviderSecret(model, payload.apiKeys);

          const otherOpinionsText = currentOpinions
            .filter((o) => o.modelId !== model.modelId)
            .map((o) => `[${o.label || o.modelId}]:\n${o.content}`)
            .join('\n\n---\n\n');

          const debateMessages: ChatMessage[] = [
            ...currentEnrichedMessages,
            { role: 'assistant', content: model.content },
            {
              role: 'user',
              content: `Here are the other AI models' responses to the same prompt:\n\n${otherOpinionsText}\n\nDo you agree or disagree with their responses? Address specific disagreements point-by-point. Be direct and concise — focus on new arguments, avoid restating your prior position in full, and reference the conversation context where relevant.`,
            },
          ];

          const content = await sendModelMessage(
            model,
            apiKey,
            debateMessages,
            payload.ollamaBaseUrl,
            proxyFor(model),
            payload.customEndpointBaseUrl,
          );
          return { ...model, content } satisfies ModelOpinion;
        })
      );

      const roundOpinions: ModelOpinion[] = [];
      roundSettled.forEach((result, index) => {
        if (result.status === "fulfilled") {
          roundOpinions.push(result.value);
        } else {
          const model = currentOpinions[index];
          logError("debate", `Model ${model.modelId} failed in debate round ${round}`, result.reason);
          failures.push({
            ...model,
            error: `Failed in debate round ${round}: ` + (result.reason instanceof Error ? result.reason.message : "Unknown"),
          });
        }
      });

      if (roundOpinions.length > 0) {
        currentOpinions = roundOpinions;
        for (const op of roundOpinions) {
          yield { type: 'opinion', model: op.label || op.modelId, content: op.content, phase: 'debate' };
        }
      }

      if (round === MAX_DEBATE_ROUNDS) {
        yield { type: 'progress', message: 'Maximum debate rounds reached. Proceeding to synthesis...' };
      }
    }

    finalOpinions = currentOpinions;
  }

  // Compress debate context before synthesis if compression is enabled
  let compressedContextResult: string | null = null;

  if (payload.compressionConfig?.enabled && finalOpinions.length > 0) {
    const compressionModel = payload.compressionModel ?? synthesizerModel;
    yield { type: 'progress', message: `Compressing debate context with ${compressionModel.label || compressionModel.modelId}...` };
    try {
      const compressionPrompt = buildCompressionMessage(contextMessages, finalOpinions);
      const compressionApiKey = getRequiredProviderSecret(compressionModel, payload.apiKeys);
      compressedContextResult = await sendModelMessage(
        compressionModel,
        compressionApiKey,
        [{ role: "user", content: compressionPrompt }],
        payload.ollamaBaseUrl,
        proxyFor(compressionModel),
        payload.customEndpointBaseUrl,
      );
      const originalEstimate = estimateTokens(
        finalOpinions.map((o) => o.content).join(" ") +
          contextMessages.map((m) => m.content).join(" "),
      );
      const compressedEstimate = estimateTokens(compressedContextResult);
      yield { type: 'compressed', compressedContext: compressedContextResult, originalEstimate, compressedEstimate };
    } catch (compressionError) {
      // Non-fatal: log and continue without compression
      logError("compression", "Context compression failed, continuing without it", compressionError);
      compressedContextResult = null;
    }
  }

  const synthesizerApiKey = getRequiredProviderSecret(synthesizerModel, payload.apiKeys);

  yield { type: 'progress', message: `Synthesizing answers with ${(synthesizerModel.label || synthesizerModel.modelId)}...` };

  const partialPayload: GpsResponsePayload = {
    consensus: "",
    failures,
    mode: payload.debateMode ? "debate" : "gps",
    opinions: finalOpinions,
    responderCount: payload.responderModels.length,
  };

  const synthesisContent = compressedContextResult
    ? `${GPS_SYNTHESIS_PROMPT}\nThe following is a compressed summary of a multi-model research debate:\n\n${compressedContextResult}\n\nBased on this, give one final direct answer to the user.`
    : buildSynthesisMessage(contextMessages, finalOpinions);

  let consensus: string;
  try {
    consensus = await sendModelMessage(
      synthesizerModel,
      synthesizerApiKey,
      [
        {
          role: "user",
          content: synthesisContent,
        },
      ],
      payload.ollamaBaseUrl,
      proxyFor(synthesizerModel),
      payload.customEndpointBaseUrl,
    );
  } catch (synthError) {
    const normalized = normalizeProviderError(synthError);
    logError("synthesis", `Synthesizer ${synthesizerModel.modelId} failed`, synthError);
    yield {
      type: 'synthesisError',
      error: `${synthesizerModel.label || synthesizerModel.modelId}: ${normalized.message}`,
      partialPayload,
    };
    return;
  }

  yield {
    type: 'result',
    payload: {
      ...partialPayload,
      consensus,
    }
  };
}

export type SynthesisRetryPayload = {
  messages: ChatMessage[];
  opinions: ModelOpinion[];
  synthesizerModel: ModelSelection;
  mode: "gps" | "debate";
};

export type SynthesisRetryExecutionPayload = SynthesisRetryPayload & {
  apiKeys: ApiKeyMap;
  customEndpointBaseUrl?: string;
  ollamaBaseUrl?: string;
  ollamaBypassProxy?: boolean;
  proxyUrl?: string;
};

export async function runSynthesisOnly(
  payload: SynthesisRetryExecutionPayload,
): Promise<string> {
  const apiKey = getRequiredProviderSecret(payload.synthesizerModel, payload.apiKeys);

  const cleanMessages = payload.messages
    .filter(
      (m): m is ChatMessage =>
        Boolean(m?.content?.trim()) && (m.role === "user" || m.role === "assistant"),
    )
    .map((m) => ({ role: m.role, content: m.content.trim() }));

  const synthProxy = payload.ollamaBypassProxy && payload.synthesizerModel.providerId === "ollama"
    ? undefined
    : payload.proxyUrl;

  return sendModelMessage(
    payload.synthesizerModel,
    apiKey,
    [{ role: "user", content: buildSynthesisMessage(cleanMessages, payload.opinions) }],
    payload.ollamaBaseUrl,
    synthProxy,
    payload.customEndpointBaseUrl,
  );
}
