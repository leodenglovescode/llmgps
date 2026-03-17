import {
  type ChatMessage,
  type ModelSelection,
  GPS_OPINION_SUFFIX,
  GPS_SYNTHESIS_PROMPT,
  getProvider,
} from "@/lib/llm";
import { type WebSearchConfig } from "@/lib/app-config";

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
  gpsMode: boolean;
  debateMode?: boolean;
  messages: ChatMessage[];
  responderModels: ModelSelection[];
  synthesizerModel?: ModelSelection | null;
};

export type GpsExecutionPayload = ClientGpsRequestPayload & {
  apiKeys: ApiKeyMap;
  ollamaBaseUrl?: string;
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

async function maybeInjectWebSearch(
  messages: ChatMessage[],
  config: WebSearchConfig | undefined,
  proxyUrl?: string,
): Promise<{ messages: ChatMessage[]; searched: boolean }> {
  if (!config?.enabled || !config.apiKey?.trim()) {
    return { messages, searched: false };
  }

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) {
    return { messages, searched: false };
  }

  try {
    const results = await fetchWebSearchResults(lastUserMessage.content, config, proxyUrl);
    const block = buildSearchContextBlock(results);
    if (!block) {
      return { messages, searched: false };
    }

    return {
      messages: [
        { role: "user" as const, content: block },
        { role: "assistant" as const, content: "Thank you for the web search context. I will use these results to inform my response." },
        ...messages,
      ],
      searched: true,
    };
  } catch {
    return { messages, searched: false };
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

function getOpenAICompatibleBaseUrl(providerId: ModelSelection["providerId"]) {
  switch (providerId) {
    case "openai":
      return "https://api.openai.com/v1/chat/completions";
    case "openrouter":
      return "https://openrouter.ai/api/v1/chat/completions";
    case "deepseek":
      return "https://api.deepseek.com/chat/completions";
    case "xai":
      return "https://api.x.ai/v1/chat/completions";
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

  return error instanceof Error
    ? new GpsError(error.message, 500)
    : new GpsError("The provider request failed.", 500);
}

async function sendOpenAICompatibleMessage(
  model: ModelSelection,
  apiKey: string,
  messages: ChatMessage[],
  proxyUrl?: string,
) {
  try {
    const response = await proxyFetch(getOpenAICompatibleBaseUrl(model.providerId), {
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
) {
  const provider = getProvider(model.providerId);

  if (!provider) {
    throw new GpsError(`Unknown provider: ${model.providerId}.`, 400);
  }

  switch (provider.requestShape) {
    case "openai-compatible":
      return sendOpenAICompatibleMessage(model, apiKey || "", messages, proxyUrl);
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
  );

  const primaryModel = payload.responderModels[0];

  if (!payload.gpsMode && !payload.debateMode) {
    const apiKey = getRequiredProviderSecret(primaryModel, payload.apiKeys);
    const content = await sendModelMessage(
      primaryModel,
      apiKey,
      enrichedMessages,
      payload.ollamaBaseUrl,
      payload.proxyUrl,
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
        payload.proxyUrl,
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
  | { type: 'opinion'; model: string; content: string; phase: 'initial' | 'debate' };

export async function* runGpsWorkflowStreaming(
  payload: GpsExecutionPayload,
): AsyncGenerator<GpsStreamEvent, void, unknown> {
  ensureValidRequest(payload);

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

  if (payload.webSearchConfig?.enabled && payload.webSearchConfig.apiKey?.trim()) {
    yield { type: 'progress', message: 'Searching the web...' };
  }

  const { messages: enrichedMessages, searched } = await maybeInjectWebSearch(
    cleanMessages,
    payload.webSearchConfig,
    payload.proxyUrl,
  );

  if (searched) {
    yield { type: 'progress', message: 'Web search results injected.' };
  }

  const primaryModel = payload.responderModels[0];

  if (!payload.gpsMode && !payload.debateMode) {
    const apiKey = getRequiredProviderSecret(primaryModel, payload.apiKeys);

    yield { type: 'progress', message: `Trying to access ${(primaryModel.label || primaryModel.modelId)} API...` };
    yield { type: 'progress', message: `Sending prompt to ${(primaryModel.label || primaryModel.modelId)}...` };

    const content = await sendModelMessage(
      primaryModel,
      apiKey,
      enrichedMessages,
      payload.ollamaBaseUrl,
      payload.proxyUrl,
    );
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
        payload.proxyUrl,
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

  let finalOpinions = initialOpinions;

  // Debate Round
  if (payload.debateMode && initialOpinions.length > 1) {
    yield { type: 'progress', message: 'Entering Debate Mode: cross-referencing AI responses...' };

    const debateRoundSettled = await Promise.allSettled(
      initialOpinions.map(async (model) => {
        const apiKey = getRequiredProviderSecret(model, payload.apiKeys);

        const otherOpinionsText = initialOpinions
          .filter((o) => o.modelId !== model.modelId)
          .map((o) => `[${o.label || o.modelId}]:\n${o.content}`)
          .join('\n\n---\n\n');

        // Give each model: full conversation history + its own opinion as assistant turn + other models' opinions
        const debateMessages: ChatMessage[] = [
          ...opinionMessages,
          { role: 'assistant', content: model.content },
          {
            role: 'user',
            content: `Here are the other AI models' responses to the same prompt:\n\n${otherOpinionsText}\n\nDo you agree or disagree with their responses? Debate their points clearly and concisely, referencing the conversation context where relevant.`,
          },
        ];

        const content = await sendModelMessage(
          model,
          apiKey,
          debateMessages,
          payload.ollamaBaseUrl,
          payload.proxyUrl,
        );
        return { ...model, content } satisfies ModelOpinion;
      })
    );

    const debateOpinions: ModelOpinion[] = [];
    debateRoundSettled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        debateOpinions.push(result.value);
      } else {
        const model = initialOpinions[index];
        console.error(`[Debate Phase] Model ${model.modelId} failed:`, result.reason);
        failures.push({
          ...model,
          error: "Failed during debate phase: " + (result.reason instanceof Error ? result.reason.message : "Unknown"),
        });
      }
    });

    if (debateOpinions.length > 0) {
      finalOpinions = debateOpinions;
      for (const op of debateOpinions) {
        yield { type: 'opinion', model: op.label || op.modelId, content: op.content, phase: 'debate' };
      }
    }
  }

  const synthesizerModel = payload.synthesizerModel;
  if (!synthesizerModel) {
    throw new GpsError("Choose a synthesizer model before using GPS Mode.", 400);
  }

  const synthesizerApiKey = getRequiredProviderSecret(synthesizerModel, payload.apiKeys);

  yield { type: 'progress', message: `Synthesizing answers with ${(synthesizerModel.label || synthesizerModel.modelId)}...` };

  const consensus = await sendModelMessage(
    synthesizerModel,
    synthesizerApiKey,
    [
      {
        role: "user",
        content: buildSynthesisMessage(cleanMessages, finalOpinions),
      },
    ],
    payload.ollamaBaseUrl,
  );

  yield {
    type: 'result',
    payload: {
      consensus,
      failures,
      mode: payload.debateMode ? "debate" : "gps",
      opinions: finalOpinions,
      responderCount: payload.responderModels.length,
    }
  };
}
