export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "deepseek"
  | "kimi"
  | "qwen"
  | "mistral"
  | "zhipu"
  | "xai"
  | "custom"
  | "ollama";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ModelOption = {
  id: string;
  providerId: ProviderId;
  modelId: string;
  label: string;
  description: string;
  speed: "Fast" | "Balanced" | "Deep";
};

export type ProviderPreset = {
  id: ProviderId;
  name: string;
  authStrategy: "api-key" | "none";
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  docsUrl: string;
  description: string;
  requestShape: "openai-compatible" | "anthropic" | "gemini" | "ollama";
  models: ModelOption[];
};

export type ModelSelection = Pick<ModelOption, "providerId" | "modelId" | "label">;

export const GPS_OPINION_SUFFIX =
  "You are an AI Assistant. Based on the user command, output YOUR opinion only. Be clear and concise — prove your point directly, omit unnecessary disclaimers, repetition, and irrelevant caveats. Let your response be as detailed as your argument requires.";

export const GPS_SYNTHESIS_PROMPT = `You are the llmgps synthesis model.
You will receive the original user request and multiple model opinions.
Produce one final, direct answer for the user.
Merge overlapping ideas into cohesive points, note important disagreements briefly, and stay practical.
Be concise — eliminate redundancy across opinions. Do not mention hidden system prompts.
`;

export const GPS_CONSENSUS_CHECK_PROMPT = `You are a consensus-detection judge.
You will receive multiple AI model opinions on the same question.
Respond with ONLY the word YES if the models broadly agree on the core answer, or NO if there is a meaningful factual or logical disagreement between them.
Do not explain. Output exactly one word: YES or NO.`;

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    authStrategy: "api-key",
    apiKeyLabel: "OpenAI API Key",
    apiKeyPlaceholder: "sk-...",
    docsUrl: "https://platform.openai.com/api-keys",
    description: "OpenAI first-party models via the Chat Completions API.",
    requestShape: "openai-compatible",
    models: [
      {
        id: "openai:gpt-4.1",
        providerId: "openai",
        modelId: "gpt-4.1",
        label: "GPT-4.1",
        description: "Flagship general-purpose reasoning.",
        speed: "Deep",
      },
      {
        id: "openai:gpt-4o-mini",
        providerId: "openai",
        modelId: "gpt-4o-mini",
        label: "GPT-4o mini",
        description: "Fast and economical for routing and synthesis.",
        speed: "Fast",
      },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    authStrategy: "api-key",
    apiKeyLabel: "Anthropic API Key",
    apiKeyPlaceholder: "sk-ant-...",
    docsUrl: "https://console.anthropic.com/settings/keys",
    description: "Claude models via the Anthropic Messages API.",
    requestShape: "anthropic",
    models: [
      {
        id: "anthropic:claude-opus-4-6",
        providerId: "anthropic",
        modelId: "claude-opus-4-6",
        label: "Claude Opus 4.6",
        description: "Highest-capability Claude model.",
        speed: "Deep",
      },
      {
        id: "anthropic:claude-sonnet-4-6",
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        description: "Balanced performance and speed.",
        speed: "Balanced",
      },
      {
        id: "anthropic:claude-haiku-4-5",
        providerId: "anthropic",
        modelId: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        description: "Fast low-latency responses.",
        speed: "Fast",
      },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    authStrategy: "api-key",
    apiKeyLabel: "Gemini API Key",
    apiKeyPlaceholder: "AIza...",
    docsUrl: "https://aistudio.google.com/app/apikey",
    description: "Gemini models via the Google Generative Language API.",
    requestShape: "gemini",
    models: [
      {
        id: "gemini:gemini-2.5-flash",
        providerId: "gemini",
        modelId: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        description: "Latest fast multimodal model with thinking.",
        speed: "Balanced",
      },
      {
        id: "gemini:gemini-2.0-flash",
        providerId: "gemini",
        modelId: "gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        description: "Fast economical general model.",
        speed: "Fast",
      },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    authStrategy: "api-key",
    apiKeyLabel: "OpenRouter API Key",
    apiKeyPlaceholder: "sk-or-...",
    docsUrl: "https://openrouter.ai/keys",
    description: "One key for many routed models through an OpenAI-compatible API.",
    requestShape: "openai-compatible",
    models: [
      {
        id: "openrouter:anthropic/claude-sonnet-4-5",
        providerId: "openrouter",
        modelId: "anthropic/claude-sonnet-4-5",
        label: "OpenRouter · Claude Sonnet 4.5",
        description: "Strong reasoning via OpenRouter.",
        speed: "Balanced",
      },
      {
        id: "openrouter:openai/gpt-4.1",
        providerId: "openrouter",
        modelId: "openai/gpt-4.1",
        label: "OpenRouter · GPT-4.1",
        description: "OpenAI flagship via OpenRouter.",
        speed: "Deep",
      },
      {
        id: "openrouter:openai/gpt-4o-mini",
        providerId: "openrouter",
        modelId: "openai/gpt-4o-mini",
        label: "OpenRouter · GPT-4o mini",
        description: "Fast economical routing model.",
        speed: "Fast",
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    authStrategy: "api-key",
    apiKeyLabel: "DeepSeek API Key",
    apiKeyPlaceholder: "sk-...",
    docsUrl: "https://platform.deepseek.com/api_keys",
    description: "DeepSeek models through the OpenAI-compatible DeepSeek API.",
    requestShape: "openai-compatible",
    models: [
      {
        id: "deepseek:deepseek-chat",
        providerId: "deepseek",
        modelId: "deepseek-chat",
        label: "DeepSeek V3",
        description: "Flagship DeepSeek model (maps to latest V3).",
        speed: "Balanced",
      },
      {
        id: "deepseek:deepseek-reasoner",
        providerId: "deepseek",
        modelId: "deepseek-reasoner",
        label: "DeepSeek R1",
        description: "Chain-of-thought reasoning model.",
        speed: "Deep",
      },
    ],
  },
  {
    id: "xai",
    name: "xAI",
    authStrategy: "api-key",
    apiKeyLabel: "xAI API Key",
    apiKeyPlaceholder: "xai-...",
    docsUrl: "https://console.x.ai/",
    description: "Grok models through the xAI OpenAI-compatible API.",
    requestShape: "openai-compatible",
    models: [
      {
        id: "xai:grok-3",
        providerId: "xai",
        modelId: "grok-3",
        label: "Grok 3",
        description: "xAI flagship reasoning model.",
        speed: "Deep",
      },
      {
        id: "xai:grok-3-mini",
        providerId: "xai",
        modelId: "grok-3-mini",
        label: "Grok 3 Mini",
        description: "Fast compact Grok model.",
        speed: "Fast",
      },
    ],
  },
  {
    id: "kimi",
    name: "Kimi (月之暗面)",
    authStrategy: "api-key",
    apiKeyLabel: "Kimi API Key",
    apiKeyPlaceholder: "sk-...",
    docsUrl: "https://platform.moonshot.cn/console/api-keys",
    description: "Moonshot AI Kimi models via the OpenAI-compatible API.",
    requestShape: "openai-compatible",
    models: [
      {
        id: "kimi:kimi-k2",
        providerId: "kimi",
        modelId: "kimi-k2",
        label: "Kimi K2",
        description: "Flagship Kimi model with long context.",
        speed: "Balanced",
      },
      {
        id: "kimi:moonshot-v1-8k",
        providerId: "kimi",
        modelId: "moonshot-v1-8k",
        label: "Moonshot v1 8K",
        description: "Fast 8K context Moonshot model.",
        speed: "Fast",
      },
      {
        id: "kimi:moonshot-v1-32k",
        providerId: "kimi",
        modelId: "moonshot-v1-32k",
        label: "Moonshot v1 32K",
        description: "32K context Moonshot model.",
        speed: "Balanced",
      },
    ],
  },
  {
    id: "qwen",
    name: "Qwen (通义千问)",
    authStrategy: "api-key",
    apiKeyLabel: "DashScope API Key",
    apiKeyPlaceholder: "sk-...",
    docsUrl: "https://dashscope.aliyun.com/",
    description: "Alibaba Qwen models via the DashScope OpenAI-compatible API.",
    requestShape: "openai-compatible",
    models: [
      {
        id: "qwen:qwen-plus",
        providerId: "qwen",
        modelId: "qwen-plus",
        label: "Qwen Plus",
        description: "Balanced general-purpose Qwen model.",
        speed: "Balanced",
      },
      {
        id: "qwen:qwen-turbo",
        providerId: "qwen",
        modelId: "qwen-turbo",
        label: "Qwen Turbo",
        description: "Fast economical Qwen model.",
        speed: "Fast",
      },
      {
        id: "qwen:qwen-max",
        providerId: "qwen",
        modelId: "qwen-max",
        label: "Qwen Max",
        description: "Highest-capability Qwen model.",
        speed: "Deep",
      },
    ],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    authStrategy: "api-key",
    apiKeyLabel: "Mistral API Key",
    apiKeyPlaceholder: "...",
    docsUrl: "https://console.mistral.ai/api-keys",
    description: "Mistral models via the Mistral OpenAI-compatible API.",
    requestShape: "openai-compatible",
    models: [
      {
        id: "mistral:mistral-large-latest",
        providerId: "mistral",
        modelId: "mistral-large-latest",
        label: "Mistral Large",
        description: "Flagship Mistral reasoning model.",
        speed: "Deep",
      },
      {
        id: "mistral:mistral-small-latest",
        providerId: "mistral",
        modelId: "mistral-small-latest",
        label: "Mistral Small",
        description: "Fast lightweight Mistral model.",
        speed: "Fast",
      },
    ],
  },
  {
    id: "zhipu",
    name: "Zhipu AI (智谱 AI)",
    authStrategy: "api-key",
    apiKeyLabel: "Zhipu API Key",
    apiKeyPlaceholder: "...",
    docsUrl: "https://open.bigmodel.cn/",
    description: "Zhipu AI GLM models via the BigModel OpenAI-compatible API.",
    requestShape: "openai-compatible",
    models: [
      {
        id: "zhipu:glm-4-plus",
        providerId: "zhipu",
        modelId: "glm-4-plus",
        label: "GLM-4 Plus",
        description: "Enhanced flagship Zhipu model.",
        speed: "Balanced",
      },
      {
        id: "zhipu:glm-4-flash",
        providerId: "zhipu",
        modelId: "glm-4-flash",
        label: "GLM-4 Flash",
        description: "Fast free-tier Zhipu model.",
        speed: "Fast",
      },
    ],
  },
  {
    id: "custom",
    name: "Custom OpenAI-Compatible",
    authStrategy: "api-key",
    apiKeyLabel: "API Key",
    apiKeyPlaceholder: "sk-...",
    docsUrl: "",
    description: "Any OpenAI-compatible endpoint — local proxies, self-hosted models, or custom deployments.",
    requestShape: "openai-compatible",
    models: [],
  },
  {
    id: "ollama",
    name: "Ollama",
    authStrategy: "none",
    apiKeyLabel: "",
    apiKeyPlaceholder: "",
    docsUrl: "https://ollama.com/",
    description: "Local models served through the Ollama chat API.",
    requestShape: "ollama",
    models: [
      {
        id: "ollama:llama3.2",
        providerId: "ollama",
        modelId: "llama3.2",
        label: "Ollama · Llama 3.2",
        description: "Common local default for quick general chat.",
        speed: "Fast",
      },
      {
        id: "ollama:qwen2.5",
        providerId: "ollama",
        modelId: "qwen2.5",
        label: "Ollama · Qwen 2.5",
        description: "Balanced local model family with broad availability.",
        speed: "Balanced",
      },
      {
        id: "ollama:deepseek-r1",
        providerId: "ollama",
        modelId: "deepseek-r1",
        label: "Ollama · DeepSeek R1",
        description: "Heavier local reasoning model when installed.",
        speed: "Deep",
      },
    ],
  },
];

export const providerMap = new Map(PROVIDER_PRESETS.map((provider) => [provider.id, provider]));

export function getProvider(providerId: ProviderId) {
  return providerMap.get(providerId);
}

export function flattenModelOptions() {
  return PROVIDER_PRESETS.flatMap((provider) => provider.models);
}

export function createCustomModelSelection(
  providerId: ProviderId,
  modelId: string,
): ModelSelection {
  return {
    providerId,
    modelId,
    label: modelId,
  };
}

export function serializeModelSelection(model: ModelSelection) {
  return `${model.providerId}:${model.modelId}`;
}