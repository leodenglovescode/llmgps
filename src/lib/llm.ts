export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "deepseek"
  | "xai"
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
        id: "anthropic:claude-3-7-sonnet-latest",
        providerId: "anthropic",
        modelId: "claude-3-7-sonnet-latest",
        label: "Claude 3.7 Sonnet",
        description: "Strong writing and reasoning.",
        speed: "Balanced",
      },
      {
        id: "anthropic:claude-3-5-haiku-latest",
        providerId: "anthropic",
        modelId: "claude-3-5-haiku-latest",
        label: "Claude 3.5 Haiku",
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
        id: "gemini:gemini-2.0-flash",
        providerId: "gemini",
        modelId: "gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        description: "Fast multimodal-leaning general model.",
        speed: "Fast",
      },
      {
        id: "gemini:gemini-1.5-pro",
        providerId: "gemini",
        modelId: "gemini-1.5-pro",
        label: "Gemini 1.5 Pro",
        description: "Balanced deeper analysis.",
        speed: "Deep",
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
        id: "openrouter:openai/gpt-4o-mini",
        providerId: "openrouter",
        modelId: "openai/gpt-4o-mini",
        label: "OpenRouter · GPT-4o mini",
        description: "Quick synthesis and baseline responses.",
        speed: "Fast",
      },
      {
        id: "openrouter:anthropic/claude-3.5-sonnet",
        providerId: "openrouter",
        modelId: "anthropic/claude-3.5-sonnet",
        label: "OpenRouter · Claude 3.5 Sonnet",
        description: "Good reasoning through OpenRouter routing.",
        speed: "Balanced",
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
        label: "DeepSeek Chat",
        description: "Balanced general-purpose DeepSeek model.",
        speed: "Balanced",
      },
      {
        id: "deepseek:deepseek-reasoner",
        providerId: "deepseek",
        modelId: "deepseek-reasoner",
        label: "DeepSeek Reasoner",
        description: "Deeper reasoning for synthesis and longer thinking.",
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
        id: "xai:grok-2-latest",
        providerId: "xai",
        modelId: "grok-2-latest",
        label: "Grok 2 Latest",
        description: "General purpose Grok preset.",
        speed: "Balanced",
      },
      {
        id: "xai:grok-beta",
        providerId: "xai",
        modelId: "grok-beta",
        label: "Grok Beta",
        description: "Fallback alias if your account exposes older presets.",
        speed: "Fast",
      },
    ],
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