import {
  type ChatMessage,
  type ModelSelection,
  GPS_OPINION_SUFFIX,
  GPS_SYNTHESIS_PROMPT,
  getProvider,
} from "@/lib/llm";

import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import nodeFetch from "node-fetch";

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

export type GpsRequestPayload = {
  apiKeys: ApiKeyMap;
  gpsMode: boolean;
  debateMode?: boolean;
  messages: ChatMessage[];
  responderModels: ModelSelection[];
  synthesizerModel?: ModelSelection | null;
  proxyUrl?: string;
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
  mode: "gps" | "single";
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

async function parseError(response: Response) {
  try {
    const json = (await response.json()) as { error?: { message?: string } };
    return json.error?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function sendOpenAICompatibleMessage(
  model: ModelSelection,
  apiKey: string,
  messages: ChatMessage[],
  proxyUrl?: string,
) {
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
    signal: AbortSignal.timeout(60_000),
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
}

async function sendAnthropicMessage(
  model: ModelSelection,
  apiKey: string,
  messages: ChatMessage[],
  proxyUrl?: string,
) {
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
    signal: AbortSignal.timeout(60_000),
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
}

async function sendGeminiMessage(
  model: ModelSelection,
  apiKey: string,
  messages: ChatMessage[],
  proxyUrl?: string,
) {
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
      signal: AbortSignal.timeout(60_000),
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
}

async function sendModelMessage(
  model: ModelSelection,
  apiKey: string,
  messages: ChatMessage[],
  proxyUrl?: string,
) {
  const provider = getProvider(model.providerId);

  if (!provider) {
    throw new GpsError(`Unknown provider: ${model.providerId}.`, 400);
  }

  switch (provider.requestShape) {
    case "openai-compatible":
      return sendOpenAICompatibleMessage(model, apiKey, messages, proxyUrl);
    case "anthropic":
      return sendAnthropicMessage(model, apiKey, messages, proxyUrl);
    case "gemini":
      return sendGeminiMessage(model, apiKey, messages, proxyUrl);
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

function ensureValidRequest(payload: GpsRequestPayload) {
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
  payload: GpsRequestPayload,
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

  const primaryModel = payload.responderModels[0];

  if (!payload.gpsMode && !payload.debateMode) {
    const apiKey = payload.apiKeys[primaryModel.providerId]?.trim();

    if (!apiKey) {
      throw new GpsError(`Missing API key for ${primaryModel.providerId}.`, 400);
    }

    const content = await sendModelMessage(primaryModel, apiKey, cleanMessages, payload.proxyUrl);

    return {
      consensus: content,
      failures: [],
      mode: "single",
      opinions: [{ ...primaryModel, content }],
      responderCount: 1,
    };
  }

  const opinionMessages = buildOpinionMessages(cleanMessages);
  const settled = await Promise.allSettled(
    payload.responderModels.map(async (model) => {
      const apiKey = payload.apiKeys[model.providerId]?.trim();

      if (!apiKey) {
        throw new GpsError(`Missing API key for ${model.providerId}.`, 400);
      }

      const content = await sendModelMessage(model, apiKey, opinionMessages, payload.proxyUrl);

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

  const synthesizerApiKey = payload.apiKeys[synthesizerModel.providerId]?.trim();

  if (!synthesizerApiKey) {
    throw new GpsError(`Missing API key for ${synthesizerModel.providerId}.`, 400);
  }

  const consensus = await sendModelMessage(synthesizerModel, synthesizerApiKey, [
    {
      role: "user",
      content: buildSynthesisMessage(cleanMessages, opinions),
    },
  ]);

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
  payload: GpsRequestPayload,
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

  const primaryModel = payload.responderModels[0];

  if (!payload.gpsMode && !payload.debateMode) {
    const apiKey = payload.apiKeys[primaryModel.providerId]?.trim();
    if (!apiKey) {
      throw new GpsError(`Missing API key for ${primaryModel.providerId}.`, 400);
    }

    yield { type: 'progress', message: `Trying to access ${(primaryModel.label || primaryModel.modelId)} API...` };
    yield { type: 'progress', message: `Sending prompt to ${(primaryModel.label || primaryModel.modelId)}...` };

    const content = await sendModelMessage(primaryModel, apiKey, cleanMessages, payload.proxyUrl);
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

  const opinionMessages = buildOpinionMessages(cleanMessages);
  
  yield { type: 'progress', message: 'Sending prompt to responder models...' };

  const initialOpinions: ModelOpinion[] = [];
  const failures: ModelFailure[] = [];

  // First Round
  const firstRoundSettled = await Promise.allSettled(
    payload.responderModels.map(async (model) => {
      const apiKey = payload.apiKeys[model.providerId]?.trim();
      if (!apiKey) throw new GpsError(`Missing API key for ${model.providerId}.`, 400);
      
      const content = await sendModelMessage(model, apiKey, opinionMessages, payload.proxyUrl);
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
    const debateSystemPrompt = "You are an AI Assistant. You will now be given other LLMs responses to the original prompt. Debate whether you agree or disagree with other LLMs opinions. Do not limit your length, explain yourself fully.";
    
    // Construct the context of everyone else's opinions
    const allOpinionsText = initialOpinions.map(o => `[${o.modelId}]:\n${o.content}`).join('\n\n---\n\n');

    const debateRoundSettled = await Promise.allSettled(
      initialOpinions.map(async (model) => {
        const apiKey = payload.apiKeys[model.providerId]?.trim();
        if (!apiKey) throw new GpsError(`Missing API key for ${model.providerId}.`, 400);

        const debateMessages: ChatMessage[] = [
          ...cleanMessages,
          { role: 'assistant', content: 'Here are the responses from other models.\n\n' + allOpinionsText },
          { role: 'user', content: debateSystemPrompt }
        ];

        const content = await sendModelMessage(model, apiKey, debateMessages, payload.proxyUrl);
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

  const synthesizerApiKey = payload.apiKeys[synthesizerModel.providerId]?.trim();
  if (!synthesizerApiKey) {
    throw new GpsError(`Missing API key for ${synthesizerModel.providerId}.`, 400);
  }

  yield { type: 'progress', message: `Synthesizing answers with ${(synthesizerModel.label || synthesizerModel.modelId)}...` };

  const consensus = await sendModelMessage(synthesizerModel, synthesizerApiKey, [
    {
      role: "user",
      content: buildSynthesisMessage(cleanMessages, finalOpinions),
    },
  ]);

  yield {
    type: 'result',
    payload: {
      consensus,
      failures,
      mode: "gps",
      opinions: finalOpinions,
      responderCount: payload.responderModels.length,
    }
  };
}
