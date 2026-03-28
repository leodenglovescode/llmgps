import {
  type ModelSelection,
  type ProviderId,
  serializeModelSelection,
} from "@/lib/llm";
import type { Language } from "@/lib/locales";

export type ProxyConfig = {
  enabled: boolean;
  type: "http" | "socks5" | "none";
  host: string;
  port: string;
  username: string;
  password: string;
};

export const defaultProxyConfig: ProxyConfig = {
  enabled: false,
  type: "none",
  host: "",
  port: "",
  username: "",
  password: "",
};

export type OllamaConfig = {
  enabled: boolean;
  baseUrl: string;
  bypassProxy: boolean;
};

export const defaultOllamaConfig: OllamaConfig = {
  enabled: false,
  baseUrl: "http://127.0.0.1:11434",
  bypassProxy: false,
};

export type WebSearchConfig = {
  enabled: boolean;
  provider: "brave" | "tavily";
  apiKey: string;
  maxResults: number;
};

export const defaultWebSearchConfig: WebSearchConfig = {
  enabled: false,
  provider: "brave",
  apiKey: "",
  maxResults: 5,
};

export type CustomEndpointConfig = {
  baseUrl: string;
};

export const defaultCustomEndpointConfig: CustomEndpointConfig = {
  baseUrl: "",
};

export function sanitizeCustomEndpointConfig(input?: Partial<CustomEndpointConfig> | null): CustomEndpointConfig {
  if (!input) return { ...defaultCustomEndpointConfig };
  return {
    baseUrl: typeof input.baseUrl === "string" ? input.baseUrl.trim() : "",
  };
}

export type CompressionConfig = {
  enabled: boolean;
  rollingContext: boolean;
  targetTokens: number;
  modelContextOverrides: Record<string, number>;
};

export const defaultCompressionConfig: CompressionConfig = {
  enabled: false,
  rollingContext: false,
  targetTokens: 1500,
  modelContextOverrides: {},
};

export function sanitizeCompressionConfig(
  input?: Partial<CompressionConfig> | null,
): CompressionConfig {
  if (!input) return { ...defaultCompressionConfig };

  const targetTokens =
    typeof input.targetTokens === "number" && input.targetTokens >= 200 && input.targetTokens <= 16000
      ? Math.round(input.targetTokens)
      : defaultCompressionConfig.targetTokens;

  const modelContextOverrides: Record<string, number> = {};
  if (input.modelContextOverrides && typeof input.modelContextOverrides === "object") {
    for (const [key, value] of Object.entries(input.modelContextOverrides)) {
      if (typeof key === "string" && key.trim() && typeof value === "number" && value >= 1000) {
        modelContextOverrides[key.trim()] = value;
      }
    }
  }

  return {
    enabled: Boolean(input.enabled),
    rollingContext: Boolean(input.rollingContext),
    targetTokens,
    modelContextOverrides,
  };
}

export type RoutingPreferencesPayload = {
  compressionConfig: CompressionConfig;
  compressionModel: ModelSelection | null;
  customModels: ModelSelection[];
  debateMode: boolean;
  responderModels: ModelSelection[];
  searchQueryModel: ModelSelection | null;
  synthesizerModel: ModelSelection | null;
};

export const defaultRoutingPreferences: RoutingPreferencesPayload = {
  compressionConfig: { ...defaultCompressionConfig },
  compressionModel: null,
  customModels: [],
  debateMode: false,
  responderModels: [],
  searchQueryModel: null,
  synthesizerModel: null,
};

export type AppStatusPayload = {
  authenticated: boolean;
  configuredProviders: ProviderId[];
  customEndpointConfig: CustomEndpointConfig;
  initialized: boolean;
  language: Language;
  ollamaConfig: OllamaConfig;
  proxyConfig: ProxyConfig;
  routingPreferences: RoutingPreferencesPayload;
  shouldPromptForApiKeys: boolean;
  username: string | null;
  webSearchConfig: WebSearchConfig;
};

export function sanitizeLanguage(input: unknown): Language {
  if (input === "en" || input === "zh") return input;
  return "auto";
}

export { type Language };

function sanitizeModelSelection(input: unknown): ModelSelection | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<ModelSelection>;
  const providerId = candidate.providerId;

  if (
    providerId !== "openai" &&
    providerId !== "anthropic" &&
    providerId !== "gemini" &&
    providerId !== "openrouter" &&
    providerId !== "deepseek" &&
    providerId !== "kimi" &&
    providerId !== "qwen" &&
    providerId !== "mistral" &&
    providerId !== "zhipu" &&
    providerId !== "xai" &&
    providerId !== "custom" &&
    providerId !== "ollama"
  ) {
    return null;
  }

  const modelId = typeof candidate.modelId === "string" ? candidate.modelId.trim() : "";
  const labelSource = typeof candidate.label === "string" ? candidate.label.trim() : "";

  if (!modelId) {
    return null;
  }

  return {
    providerId,
    modelId,
    label: labelSource || modelId,
  };
}

function sanitizeModelSelectionList(input: unknown, maxItems?: number) {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const next: ModelSelection[] = [];

  for (const item of input) {
    const selection = sanitizeModelSelection(item);
    if (!selection) {
      continue;
    }

    const key = serializeModelSelection(selection);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    next.push(selection);

    if (typeof maxItems === "number" && next.length >= maxItems) {
      break;
    }
  }

  return next;
}

export function sanitizeRoutingPreferences(
  input?: Partial<RoutingPreferencesPayload> | null,
): RoutingPreferencesPayload {
  if (!input) {
    return {
      compressionConfig: { ...defaultCompressionConfig },
      compressionModel: null,
      customModels: [],
      debateMode: false,
      responderModels: [],
      searchQueryModel: null,
      synthesizerModel: null,
    };
  }

  return {
    compressionConfig: sanitizeCompressionConfig(input.compressionConfig),
    compressionModel: sanitizeModelSelection(input.compressionModel),
    customModels: sanitizeModelSelectionList(input.customModels),
    debateMode: Boolean(input.debateMode),
    responderModels: sanitizeModelSelectionList(input.responderModels, 5),
    searchQueryModel: sanitizeModelSelection(input.searchQueryModel),
    synthesizerModel: sanitizeModelSelection(input.synthesizerModel),
  };
}

export function buildProxyUrl(proxyConfig: ProxyConfig) {
  if (!proxyConfig.enabled || proxyConfig.type === "none") {
    return undefined;
  }

  const host = proxyConfig.host.trim();
  const port = proxyConfig.port.trim();

  if (!host || !port) {
    return undefined;
  }

  const username = proxyConfig.username.trim();
  const password = proxyConfig.password.trim();

  if (username || password) {
    return `${proxyConfig.type}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
  }

  return `${proxyConfig.type}://${host}:${port}`;
}

export function sanitizeOllamaConfig(input?: Partial<OllamaConfig> | null): OllamaConfig {
  if (!input) {
    return { ...defaultOllamaConfig };
  }

  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";

  return {
    enabled: Boolean(input.enabled),
    baseUrl: baseUrl || defaultOllamaConfig.baseUrl,
    bypassProxy: Boolean(input.bypassProxy),
  };
}

export function sanitizeWebSearchConfig(input?: Partial<WebSearchConfig> | null): WebSearchConfig {
  if (!input) {
    return { ...defaultWebSearchConfig };
  }

  const provider = input.provider === "brave" || input.provider === "tavily"
    ? input.provider
    : "brave";

  const maxResults = typeof input.maxResults === "number"
    ? Math.max(1, Math.min(10, Math.round(input.maxResults)))
    : defaultWebSearchConfig.maxResults;

  return {
    enabled: Boolean(input.enabled),
    provider,
    apiKey: typeof input.apiKey === "string" ? input.apiKey : "",
    maxResults,
  };
}

export function sanitizeProxyConfig(input?: Partial<ProxyConfig> | null): ProxyConfig {
  if (!input) {
    return { ...defaultProxyConfig };
  }

  const type = input.type === "http" || input.type === "socks5" || input.type === "none"
    ? input.type
    : "none";

  return {
    enabled: Boolean(input.enabled),
    type,
    host: typeof input.host === "string" ? input.host.trim() : "",
    port: typeof input.port === "string" ? input.port.trim() : "",
    username: typeof input.username === "string" ? input.username : "",
    password: typeof input.password === "string" ? input.password : "",
  };
}
