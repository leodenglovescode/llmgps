"use client";

import { type FormEvent, useEffect, useEffectEvent, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  defaultCompressionConfig,
  defaultCustomEndpointConfig,
  defaultOllamaConfig,
  defaultProxyConfig,
  defaultRoutingPreferences,
  defaultWebSearchConfig,
  type AppStatusPayload,
  type CompressionConfig,
  type CustomEndpointConfig,
  type Language,
  type OllamaConfig,
  type ProxyConfig,
  type RoutingPreferencesPayload,
  type WebSearchConfig,
} from "@/lib/app-config";
import { en, zh, resolveLocale, type Locale } from "@/lib/locales";
import {
  buildConversationSummary,
  type CompressionRound,
  type ConversationMessage,
  type ConversationRecord,
  type ConversationSummary,
} from "@/lib/chat-history";
import type { GpsResponsePayload, ModelOpinion } from "@/lib/gps";
import {
  type ChatMessage,
  type ModelSelection,
  type ProviderId,
  PROVIDER_PRESETS,
  createCustomModelSelection,
  serializeModelSelection,
} from "@/lib/llm";

type ThemeMode = "dark" | "light";
type ViewId = "chat" | "runs" | "settings" | "apikeys";
type AuthView = "app" | "loading" | "login" | "setup";

type UiMessage = ConversationMessage;

type WebSearchResultItem = {
  title: string;
  url: string;
  snippet: string;
};

type PersistedState = {
  customModels: ModelSelection[];
  debateMode?: boolean;
  responderModels: ModelSelection[];
  synthesizerModel: ModelSelection | null;
};

type SidebarItem = {
  emoji: string;
  id: ViewId;
  label: string;
};

type SetupFormState = {
  confirmPassword: string;
  password: string;
  username: string;
};

type LoginFormState = {
  password: string;
  username: string;
};

const STORAGE_KEY = "llmgps-state";
const THEME_KEY = "llmgps-theme";

const sidebarItems: SidebarItem[] = [
  { id: "chat", emoji: "💬", label: "Chat" },
  { id: "runs", emoji: "🕘", label: "Chat History" },
  { id: "settings", emoji: "⚙️", label: "Settings" },
];

const initialMessages: UiMessage[] = [];

const initialStatus: AppStatusPayload = {
  authenticated: false,
  configuredProviders: [],
  customEndpointConfig: defaultCustomEndpointConfig,
  initialized: false,
  language: "auto",
  ollamaConfig: defaultOllamaConfig,
  proxyConfig: defaultProxyConfig,
  routingPreferences: defaultRoutingPreferences,
  shouldPromptForApiKeys: false,
  username: null,
  webSearchConfig: defaultWebSearchConfig,
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function makeEmptyApiKeyDrafts(): Record<ProviderId, string> {
  return {
    anthropic: "",
    deepseek: "",
    gemini: "",
    kimi: "",
    mistral: "",
    ollama: "",
    openai: "",
    openrouter: "",
    qwen: "",
    xai: "",
    zhipu: "",
    custom: "",
  };
}

function makeEmptyCustomDrafts(): Record<ProviderId, string> {
  return {
    anthropic: "",
    deepseek: "",
    gemini: "",
    kimi: "",
    mistral: "",
    ollama: "",
    openai: "",
    openrouter: "",
    qwen: "",
    xai: "",
    zhipu: "",
    custom: "",
  };
}

function loadPersistedState(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      customModels: Array.isArray(parsed.customModels) ? parsed.customModels : [],
      debateMode: Boolean(parsed.debateMode),
      responderModels: Array.isArray(parsed.responderModels) ? parsed.responderModels : [],
      synthesizerModel: parsed.synthesizerModel ?? null,
    };
  } catch {
    return null;
  }
}

function loadTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "light" ? "light" : "dark";
}

function getTimeBasedGreeting(date: Date, username: string | null, t: Locale) {
  const hour = date.getHours();
  const greeting = hour < 12 ? t.chat.goodMorning : hour < 18 ? t.chat.goodAfternoon : t.chat.goodEvening;
  return username ? t.chat.greeting(greeting, username) : greeting;
}

function buildWelcomePrompts(date: Date, username: string | null, t: Locale) {
  const trimmedUsername = username?.trim() || null;
  const prompts = [
    getTimeBasedGreeting(date, trimmedUsername, t),
    t.chat.whatsOnYourMind,
    t.chat.howCanIHelp,
  ];

  if (trimmedUsername) {
    prompts.splice(1, 0, t.chat.welcomeBack(trimmedUsername));
  }

  return prompts;
}

export function LlmgpsShell() {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [language, setLanguage] = useState<Language>("auto");
  const [activeView, setActiveView] = useState<ViewId>("chat");
  const [authView, setAuthView] = useState<AuthView>("loading");
  const [status, setStatus] = useState<AppStatusPayload>(initialStatus);
  const [setupForm, setSetupForm] = useState<SetupFormState>({
    confirmPassword: "",
    password: "",
    username: "",
  });
  const [loginForm, setLoginForm] = useState<LoginFormState>({ password: "", username: "" });
  const [showSetupPasswords, setShowSetupPasswords] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [customModels, setCustomModels] = useState<ModelSelection[]>([]);
  const [customDrafts, setCustomDrafts] = useState<Record<ProviderId, string>>(makeEmptyCustomDrafts());
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<ProviderId, string>>(makeEmptyApiKeyDrafts());
  const [responderModels, setResponderModels] = useState<ModelSelection[]>([]);
  const [synthesizerModel, setSynthesizerModel] = useState<ModelSelection | null>(null);
  const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>(defaultOllamaConfig);
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>(defaultProxyConfig);
  const [webSearchConfig, setWebSearchConfig] = useState<WebSearchConfig>(defaultWebSearchConfig);
  const [customEndpointConfig, setCustomEndpointConfig] = useState<CustomEndpointConfig>(defaultCustomEndpointConfig);
  const [debateMode, setDebateMode] = useState<boolean>(false);
  const [progressMsg, setProgressMsg] = useState<string>("");
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [gpsMode, setGpsMode] = useState(true);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [webSearchResults, setWebSearchResults] = useState<WebSearchResultItem[]>([]);
  const [thoughtsExpanded, setThoughtsExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [synthRetryOpen, setSynthRetryOpen] = useState(false);
  const [synthRetryError, setSynthRetryError] = useState<string | null>(null);
  const [synthRetryModel, setSynthRetryModel] = useState<ModelSelection | null>(null);
  const [synthRetryBusy, setSynthRetryBusy] = useState(false);
  const [synthRetryContext, setSynthRetryContext] = useState<{
    messages: ChatMessage[];
    opinions: ModelOpinion[];
    partialPayload: GpsResponsePayload;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsBusy, setSettingsBusy] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<GpsResponsePayload | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationSummary[]>([]);
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [welcomeNow, setWelcomeNow] = useState(() => new Date());
  const [welcomeIndex, setWelcomeIndex] = useState(0);
  const [welcomeFading, setWelcomeFading] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModelsBusy, setOllamaModelsBusy] = useState(false);
  const [ollamaModelsError, setOllamaModelsError] = useState<string | null>(null);
  const [searchQueryModel, setSearchQueryModel] = useState<ModelSelection | null>(null);
  const [compressionEnabled, setCompressionEnabled] = useState<boolean>(false);
  const [compressionModel, setCompressionModel] = useState<ModelSelection | null>(null);
  const [rollingContext, setRollingContext] = useState<boolean>(false);
  const [compressionTargetTokens, setCompressionTargetTokens] = useState<number>(1500);
  const [compressedContext, setCompressedContext] = useState<string | null>(null);
  const [compressionHistory, setCompressionHistory] = useState<CompressionRound[]>([]);

  function applyRoutingPreferences(nextPreferences: RoutingPreferencesPayload) {
    setCustomModels(nextPreferences.customModels);
    setResponderModels(nextPreferences.responderModels);
    setSynthesizerModel(nextPreferences.synthesizerModel);
    setSearchQueryModel(nextPreferences.searchQueryModel);
    setCompressionModel(nextPreferences.compressionModel);
    setDebateMode(nextPreferences.debateMode);
    if (nextPreferences.debateMode) setGpsMode(false);
    setCompressionEnabled(nextPreferences.compressionConfig?.enabled ?? false);
    setRollingContext(nextPreferences.compressionConfig?.rollingContext ?? false);
    setCompressionTargetTokens(nextPreferences.compressionConfig?.targetTokens ?? 1500);
  }

  function applyStatus(nextStatus: AppStatusPayload, options?: { syncLanguage?: boolean; syncRoutingPreferences?: boolean }) {
    setStatus(nextStatus);
    if (nextStatus.authenticated && options?.syncLanguage) {
      setLanguage(nextStatus.language ?? "auto");
    }
    setOllamaConfig(nextStatus.authenticated ? nextStatus.ollamaConfig : { ...defaultOllamaConfig });
    setProxyConfig(nextStatus.authenticated ? nextStatus.proxyConfig : { ...defaultProxyConfig });
    setWebSearchConfig(nextStatus.authenticated ? nextStatus.webSearchConfig : { ...defaultWebSearchConfig });
    setCustomEndpointConfig(nextStatus.authenticated ? nextStatus.customEndpointConfig : { ...defaultCustomEndpointConfig });
    if (nextStatus.authenticated && nextStatus.webSearchConfig.apiKey?.trim()) {
      setWebSearchEnabled(nextStatus.webSearchConfig.enabled);
    } else {
      setWebSearchEnabled(false);
    }
    setAuthView(nextStatus.initialized ? (nextStatus.authenticated ? "app" : "login") : "setup");

    if (options?.syncRoutingPreferences && nextStatus.authenticated) {
      applyRoutingPreferences(nextStatus.routingPreferences);
    }
  }

  function resetConversationState(options?: { clearConversationId?: boolean }) {
    if (options?.clearConversationId) {
      setConversationId(null);
    }
    setMessages(initialMessages);
    setDraft("");
    setBusy(false);
    setError(null);
    setLastRun(null);
    setProgressMsg("");
    setWebSearchResults([]);
    setThoughtsExpanded(false);
    setCompressedContext(null);
    setCompressionHistory([]);
  }

  function getPersistableMessages(nextMessages: UiMessage[]) {
    return nextMessages.filter((message) => message.id !== "welcome");
  }

  function upsertConversationSummary(conversation: ConversationRecord) {
    const summary = buildConversationSummary(conversation);

    setConversationHistory((current) => {
      const next = [summary, ...current.filter((entry) => entry.id !== summary.id)];
      return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }

  function applyConversation(conversation: ConversationRecord) {
    setConversationId(conversation.id);
    setMessages(conversation.messages.length > 0 ? conversation.messages : initialMessages);
    setLastRun(conversation.lastRun);
    setDraft("");
    setProgressMsg("");
    setError(null);
    setHistoryError(null);
    setCompressedContext(conversation.compressedContext ?? null);
    setCompressionHistory(conversation.compressionHistory ?? []);
  }

  async function refreshAppStatus() {
    const response = await fetch("/api/app/status", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as AppStatusPayload & { error?: string };

    if (!response.ok) {
      throw new Error(data.error || `HTTP error ${response.status}`);
    }

    applyStatus(data);
    return data;
  }

  async function saveSettings(payload: {
    apiKeys?: Partial<Record<ProviderId, string | null>>;
    customEndpointConfig?: CustomEndpointConfig;
    language?: Language;
    ollamaConfig?: OllamaConfig;
    proxyConfig?: ProxyConfig;
    routingPreferences?: RoutingPreferencesPayload;
    webSearchConfig?: WebSearchConfig;
  }, options?: { syncRoutingPreferences?: boolean }) {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as AppStatusPayload & { error?: string };

    if (!response.ok) {
      if (response.status === 401) {
        await refreshAppStatus().catch(() => undefined);
      }
      throw new Error(data.error || `HTTP error ${response.status}`);
    }

    applyStatus(data, options);
    return data;
  }

  async function loadConversation(selectedConversationId: string, options?: { openChat?: boolean }) {
    setHistoryBusy(`load:${selectedConversationId}`);
    setHistoryError(null);

    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(selectedConversationId)}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        conversation?: ConversationRecord;
        error?: string;
      };

      if (!response.ok || !data.conversation) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }

      applyConversation(data.conversation);
      upsertConversationSummary(data.conversation);

      if (options?.openChat) {
        setActiveView("chat");
      }
    } catch (requestError) {
      setHistoryError(
        requestError instanceof Error ? requestError.message : "Unable to load the conversation.",
      );
    } finally {
      setHistoryBusy(null);
    }
  }

  async function refreshConversationHistory(options?: { autoload?: boolean; preferredConversationId?: string | null }) {
    setHistoryBusy((current) => current || "list");

    try {
      const response = await fetch("/api/conversations", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        conversations?: ConversationSummary[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }

      const nextHistory = Array.isArray(data.conversations) ? data.conversations : [];
      setConversationHistory(nextHistory);

      if (options?.autoload) {
        const targetConversationId =
          options.preferredConversationId || conversationId || nextHistory[0]?.id || null;

        if (targetConversationId) {
          await loadConversation(targetConversationId);
        } else {
          resetConversationState({ clearConversationId: true });
        }
      }
    } catch (requestError) {
      setHistoryError(
        requestError instanceof Error ? requestError.message : "Unable to load conversation history.",
      );
    } finally {
      setHistoryBusy(null);
    }
  }

  async function persistConversation(
    nextMessages: UiMessage[],
    nextLastRun: GpsResponsePayload | null,
    nextConversationId?: string | null,
  ) {
    const persistableMessages = getPersistableMessages(nextMessages);

    if (!status.authenticated || persistableMessages.length === 0) {
      return nextConversationId ?? null;
    }

    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: nextConversationId ?? conversationId,
        lastRun: nextLastRun,
        messages: persistableMessages,
        compressedContext,
        compressionHistory,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as {
      conversation?: ConversationRecord;
      error?: string;
    };

    if (!response.ok || !data.conversation) {
      throw new Error(data.error || `HTTP error ${response.status}`);
    }

    setConversationId(data.conversation.id);
    upsertConversationSummary(data.conversation);
    return data.conversation.id;
  }

  async function deleteConversation(selectedConversationId: string) {
    setHistoryBusy(`delete:${selectedConversationId}`);
    setHistoryError(null);

    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(selectedConversationId)}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }

      setConversationHistory((current) => current.filter((entry) => entry.id !== selectedConversationId));

      if (conversationId === selectedConversationId) {
        resetConversationState({ clearConversationId: true });
      }
    } catch (requestError) {
      setHistoryError(
        requestError instanceof Error ? requestError.message : "Unable to delete the conversation.",
      );
    } finally {
      setHistoryBusy(null);
    }
  }

  const applyStatusEvent = useEffectEvent(applyStatus);
  const refreshConversationHistoryEvent = useEffectEvent(refreshConversationHistory);

  useEffect(() => {
    const persisted = loadPersistedState();
    if (persisted) {
      setCustomModels(persisted.customModels || []);
      setResponderModels(persisted.responderModels || []);
      setSynthesizerModel(persisted.synthesizerModel || null);
      if (persisted.debateMode) {
        setDebateMode(true);
        setGpsMode(false);
      }
    }
    setTheme(loadTheme());

    let cancelled = false;

    async function bootstrap() {
      try {
        const response = await fetch("/api/app/status", { cache: "no-store" });
        const nextStatus = (await response.json().catch(() => ({}))) as AppStatusPayload & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(nextStatus.error || `HTTP error ${response.status}`);
        }

        applyStatusEvent(nextStatus);
        if (!cancelled && nextStatus.authenticated) {
          applyRoutingPreferences(nextStatus.routingPreferences);
          setLanguage(nextStatus.language ?? "auto");
        }
        if (!cancelled && nextStatus.initialized && nextStatus.username) {
          setLoginForm((current) => ({ ...current, username: nextStatus.username || current.username }));
        }
      } catch (requestError) {
        if (!cancelled) {
          setAuthError(
            requestError instanceof Error ? requestError.message : "Unable to load llmgps.",
          );
          setAuthView("login");
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme, hydrated]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const payload: PersistedState = {
      customModels,
      debateMode,
      responderModels,
      synthesizerModel,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [customModels, debateMode, responderModels, synthesizerModel, hydrated]);

  const t = useMemo(
    () => resolveLocale(language) === "zh" ? zh : en,
    [language],
  );

  const configuredProviders = useMemo(
    () => new Set(status.configuredProviders),
    [status.configuredProviders],
  );

  const welcomePrompts = useMemo(
    () => buildWelcomePrompts(welcomeNow, status.username, t),
    [status.username, welcomeNow, t],
  );

  const activeWelcomePrompt = welcomePrompts[welcomeIndex % welcomePrompts.length] || "How can I help?";

  useEffect(() => {
    const clockTimer = window.setInterval(() => {
      setWelcomeNow(new Date());
    }, 60_000);

    return () => {
      window.clearInterval(clockTimer);
    };
  }, []);

  useEffect(() => {
    setWelcomeIndex(0);
  }, [status.username]);

  useEffect(() => {
    if (welcomePrompts.length <= 1) {
      return;
    }

    const promptTimer = window.setInterval(() => {
      setWelcomeFading(true);
      window.setTimeout(() => {
        setWelcomeIndex((current) => (current + 1) % welcomePrompts.length);
        // Let the browser paint the new text at opacity 0 first, then fade in
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setWelcomeFading(false);
          });
        });
      }, 1_400);
    }, 32_000);

    return () => {
      window.clearInterval(promptTimer);
    };
  }, [welcomePrompts.length]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (!status.authenticated) {
      setConversationHistory([]);
      setHistoryError(null);
      resetConversationState({ clearConversationId: true });
      return;
    }

    void refreshConversationHistoryEvent({});
  }, [hydrated, status.authenticated]);

  const connectedProviders = useMemo(
    () => PROVIDER_PRESETS.filter((provider) => configuredProviders.has(provider.id)),
    [configuredProviders],
  );

  const activeConversationSummary = useMemo(
    () => conversationHistory.find((conversation) => conversation.id === conversationId) ?? null,
    [conversationHistory, conversationId],
  );

  const availableModels = useMemo(() => {
    const seen = new Set<string>();
    return customModels.filter((model) => {
      const key = serializeModelSelection(model);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [customModels]);

  useEffect(() => {
    if (availableModels.length === 0) {
      setResponderModels([]);
      setSynthesizerModel(null);
      return;
    }

    const availableKeys = new Set(availableModels.map(serializeModelSelection));
    setResponderModels((current) =>
      current.filter((model) => availableKeys.has(serializeModelSelection(model))),
    );
    setSynthesizerModel((current) => {
      if (!current || !availableKeys.has(serializeModelSelection(current))) {
        return availableModels[0];
      }
      return current;
    });
  }, [availableModels]);

  function toggleResponderModel(model: ModelSelection) {
    const key = serializeModelSelection(model);
    setResponderModels((current) => {
      const exists = current.some((entry) => serializeModelSelection(entry) === key);
      if (exists) {
        return current.filter((entry) => serializeModelSelection(entry) !== key);
      }
      // Replace any existing model from the same provider
      const withoutSameProvider = current.filter((entry) => entry.providerId !== model.providerId);
      if (withoutSameProvider.length >= 5) {
        setError("You can select up to 5 responder models.");
        return current;
      }
      setError(null);
      return [...withoutSameProvider, model];
    });
  }

  function addCustomModel(providerId: ProviderId) {
    const modelId = customDrafts[providerId]?.trim();
    if (!modelId) return;

    const nextModel = createCustomModelSelection(providerId, modelId);
    const key = serializeModelSelection(nextModel);

    setCustomModels((current) => {
      if (current.some((entry) => serializeModelSelection(entry) === key)) {
        return current;
      }
      return [...current, nextModel];
    });

    setCustomDrafts((current) => ({ ...current, [providerId]: "" }));
  }

  function removeCustomModel(model: ModelSelection) {
    const key = serializeModelSelection(model);
    setCustomModels((current) =>
      current.filter((entry) => serializeModelSelection(entry) !== key),
    );
    setResponderModels((current) =>
      current.filter((entry) => serializeModelSelection(entry) !== key),
    );
    if (synthesizerModel && serializeModelSelection(synthesizerModel) === key) {
      setSynthesizerModel(null);
    }
  }

  async function handleSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (authBusy) {
      return;
    }

    if (!setupForm.username.trim() || !setupForm.password.trim()) {
      setAuthError("Username and password are required.");
      return;
    }

    if (setupForm.password !== setupForm.confirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }

    setAuthBusy(true);
    setAuthError(null);

    try {
      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: setupForm.password,
          username: setupForm.username,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }

      setLoginForm({ password: "", username: setupForm.username.trim() });
      setSetupForm({ confirmPassword: "", password: "", username: setupForm.username.trim() });
      setAuthView("login");
      setAuthError(null);
    } catch (requestError) {
      setAuthError(
        requestError instanceof Error ? requestError.message : "Unable to complete setup.",
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (authBusy) {
      return;
    }

    if (!loginForm.username.trim() || !loginForm.password.trim()) {
      setAuthError("Username and password are required.");
      return;
    }

    setAuthBusy(true);
    setAuthError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });

      const data = (await response.json().catch(() => ({}))) as AppStatusPayload & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }

      applyStatus(data, { syncLanguage: true, syncRoutingPreferences: true });
      setLoginForm((current) => ({ ...current, password: "" }));
      setApiKeyDrafts(makeEmptyApiKeyDrafts());
      setSettingsNotice(null);
      setActiveView("chat");
      setError(null);
      setHistoryError(null);
      resetConversationState({ clearConversationId: true });
    } catch (requestError) {
      setAuthError(requestError instanceof Error ? requestError.message : "Unable to log in.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    setSettingsNotice(null);
    setAuthError(null);

    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  setConversationHistory([]);
  setHistoryError(null);
  resetConversationState({ clearConversationId: true });
    setApiKeyDrafts(makeEmptyApiKeyDrafts());
  setOllamaConfig({ ...defaultOllamaConfig });
    setProxyConfig({ ...defaultProxyConfig });
    setWebSearchConfig({ ...defaultWebSearchConfig });

    try {
      await refreshAppStatus();
    } catch (requestError) {
      setAuthError(
        requestError instanceof Error ? requestError.message : "Unable to refresh login state.",
      );
      setAuthView("login");
    }
  }

  async function handleOnboardingChoice(openSettings: boolean) {
    setSettingsBusy("onboarding");
    setError(null);

    try {
      const response = await fetch("/api/auth/onboarding", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as AppStatusPayload & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }

      applyStatus(data);
      if (openSettings) {
        setActiveView("settings");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update onboarding state.",
      );
    } finally {
      setSettingsBusy(null);
    }
  }

  async function saveProviderKey(providerId: ProviderId) {
    const value = apiKeyDrafts[providerId].trim();
    if (!value) {
      setError("Enter an API key before saving it.");
      return;
    }

    setSettingsBusy(`key:${providerId}`);
    setSettingsNotice(null);
    setError(null);

    try {
      await saveSettings({ apiKeys: { [providerId]: value } });
      setApiKeyDrafts((current) => ({ ...current, [providerId]: "" }));
      setSettingsNotice(
        `${PROVIDER_PRESETS.find((provider) => provider.id === providerId)?.name || providerId} key saved on the server.`,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to save the API key.",
      );
    } finally {
      setSettingsBusy(null);
    }
  }

  async function removeProviderKey(providerId: ProviderId) {
    setSettingsBusy(`remove:${providerId}`);
    setSettingsNotice(null);
    setError(null);

    try {
      await saveSettings({ apiKeys: { [providerId]: null } });
      setApiKeyDrafts((current) => ({ ...current, [providerId]: "" }));
      setSettingsNotice(
        `${PROVIDER_PRESETS.find((provider) => provider.id === providerId)?.name || providerId} key removed from the server.`,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to remove the API key.",
      );
    } finally {
      setSettingsBusy(null);
    }
  }

  async function saveProxySettings() {
    setSettingsBusy("proxy");
    setSettingsNotice(null);
    setError(null);

    try {
      await saveSettings({ proxyConfig });
      setSettingsNotice("Proxy settings saved on the server.");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to save proxy settings.",
      );
    } finally {
      setSettingsBusy(null);
    }
  }

  async function fetchOllamaModels() {
    setOllamaModelsBusy(true);
    setOllamaModelsError(null);

    try {
      const response = await fetch("/api/ollama/tags", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { models?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP error ${response.status}`);
      const models = data.models ?? [];
      if (models.length === 0) throw new Error("No models found. Is Ollama running at the configured URL?");
      setOllamaModels(models);
    } catch (fetchError) {
      setOllamaModelsError(fetchError instanceof Error ? fetchError.message : "Could not reach Ollama.");
    } finally {
      setOllamaModelsBusy(false);
    }
  }

  async function saveOllamaSettings() {
    setSettingsBusy("ollama");
    setSettingsNotice(null);
    setError(null);

    try {
      await saveSettings({ ollamaConfig });
      setSettingsNotice(
        ollamaConfig.enabled
          ? "Ollama settings saved on the server."
          : "Ollama access disabled for this workspace.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to save Ollama settings.",
      );
    } finally {
      setSettingsBusy(null);
    }
  }

  async function saveLanguageSettings() {
    setSettingsBusy("language");
    setSettingsNotice(null);
    setError(null);

    try {
      await saveSettings({ language });
      setSettingsNotice(t.settings.languageSaved);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to save language setting.",
      );
    } finally {
      setSettingsBusy(null);
    }
  }

  async function saveWebSearchSettings() {
    setSettingsBusy("websearch");
    setSettingsNotice(null);
    setError(null);

    try {
      await saveSettings({ webSearchConfig });
      setSettingsNotice(
        webSearchConfig.enabled
          ? "Web search settings saved on the server."
          : "Web search disabled for this workspace.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to save web search settings.",
      );
    } finally {
      setSettingsBusy(null);
    }
  }

  async function saveCustomEndpointSettings() {
    setSettingsBusy("custom-endpoint");
    setSettingsNotice(null);
    setError(null);

    try {
      await saveSettings({ customEndpointConfig });
      setSettingsNotice(t.settings.endpointSaved);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to save endpoint settings.",
      );
    } finally {
      setSettingsBusy(null);
    }
  }

  async function saveRoutingPreferences() {
    setSettingsBusy("routing");
    setSettingsNotice(null);
    setError(null);

    try {
      await saveSettings(
        {
          routingPreferences: {
            customModels,
            debateMode,
            responderModels,
            synthesizerModel,
            searchQueryModel,
            compressionModel,
            compressionConfig: {
              enabled: compressionEnabled,
              rollingContext,
              targetTokens: compressionTargetTokens,
              modelContextOverrides: {},
            },
          },
        },
        { syncRoutingPreferences: true },
      );
      setSettingsNotice("Routing defaults saved on the server.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to save routing defaults.",
      );
    } finally {
      setSettingsBusy(null);
    }
  }

  async function copyToClipboard(text: string, messageId: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts or older browsers
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedMessageId(messageId);
      window.setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (error) {
      console.error("Clipboard error:", error);
      setError("Failed to copy message to clipboard.");
    }
  }

  async function sendMessage() {
    const userPrompt = draft.trim();
    if (!userPrompt || busy) return;

    if (responderModels.length === 0) {
      setError("Choose at least one responder model before sending.");
      setActiveView("settings");
      return;
    }

    if (gpsMode && !synthesizerModel) {
      setError(t.chat.noSynthesizerError);
      setActiveView("settings");
      return;
    }

    const nextUserMessage: UiMessage = {
      id: makeId(),
      role: "user",
      content: userPrompt,
    };

    const nextMessages = [...messages, nextUserMessage];

    const isRollingActive = rollingContext && compressionEnabled && Boolean(compressedContext);

    const payloadMessages: ChatMessage[] = isRollingActive
      ? [{ role: "user", content: userPrompt }]
      : nextMessages
          .filter((message) => !message.isOpinion)
          .map((message) => ({
            content: message.content,
            role: message.role,
          }));

    setMessages(nextMessages);
    setDraft("");
    setBusy(true);
    setError(null);
    setWebSearchResults([]);
    setThoughtsExpanded(false);

    try {
      let workingConversationId = conversationId;
      let workingMessages = nextMessages;

      try {
        workingConversationId = await persistConversation(workingMessages, lastRun, workingConversationId);
      } catch (historySaveError) {
        setHistoryError(
          historySaveError instanceof Error
            ? historySaveError.message
            : "Unable to save the conversation before sending.",
        );
      }

      setProgressMsg("Preparing request...");
      const response = await fetch("/api/gps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          debateMode,
          gpsMode,
          messages: payloadMessages,
          responderModels,
          synthesizerModel,
          searchQueryModel,
          compressionModel,
          webSearchEnabled,
          compressionConfig: compressionEnabled
            ? { enabled: compressionEnabled, rollingContext, targetTokens: compressionTargetTokens, modelContextOverrides: {} }
            : null,
          previousCompressedContext: isRollingActive ? compressedContext : null,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 401) {
          await refreshAppStatus().catch(() => undefined);
          throw new Error("Session expired. Please log in again.");
        }
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Stream not supported");

      const decoder = new TextDecoder();
      let streamData = "";
      let finalResult: GpsResponsePayload | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamData += decoder.decode(value, { stream: true });
        const lines = streamData.split("\n");
        streamData = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed: {
            compressedContext?: string;
            compressedEstimate?: number;
            content?: string;
            error?: string;
            message?: string;
            model?: string;
            originalEstimate?: number;
            partialPayload?: GpsResponsePayload;
            payload?: GpsResponsePayload;
            phase?: "debate" | "initial";
            results?: WebSearchResultItem[];
            type?: string;
          };
          try {
            parsed = JSON.parse(line) as {
              compressedContext?: string;
              compressedEstimate?: number;
              content?: string;
              error?: string;
              message?: string;
              model?: string;
              originalEstimate?: number;
              partialPayload?: GpsResponsePayload;
              payload?: GpsResponsePayload;
              phase?: "debate" | "initial";
              results?: WebSearchResultItem[];
              type?: string;
            };
          } catch (parseError) {
            console.error("Failed to parse stream line:", line, parseError);
            continue;
          }

          if (parsed.type === "progress") {
            setProgressMsg(parsed.message || "Working...");
          } else if (parsed.type === "compressed" && parsed.compressedContext) {
            const newRound: CompressionRound = {
              roundNumber: compressionHistory.length + 1,
              originalTokenEstimate: parsed.originalEstimate ?? 0,
              compressedTokenEstimate: parsed.compressedEstimate ?? 0,
              timestamp: new Date().toISOString(),
            };
            setCompressedContext(parsed.compressedContext);
            setCompressionHistory((prev) => [...prev, newRound]);
          } else if (parsed.type === "webSearchResults" && Array.isArray(parsed.results)) {
            setWebSearchResults(parsed.results);
          } else if (parsed.type === "result") {
            finalResult = parsed.payload || null;
          } else if (parsed.type === "opinion" && parsed.content && parsed.model && parsed.phase) {
            const opinionContent = parsed.content;
            const opinionModel = parsed.model;
            const opinionPhase = parsed.phase;
            const opinionMessage: UiMessage = {
              id: makeId(),
              role: "assistant",
              content: opinionContent,
              isOpinion: true,
              modelLabel: opinionModel,
              phase: opinionPhase,
            };
            workingMessages = [...workingMessages, opinionMessage];
            setMessages(workingMessages);
          } else if (parsed.type === "synthesisError" && parsed.partialPayload) {
            const partial = parsed.partialPayload;
            setLastRun(partial);
            setSynthRetryContext({
              messages: payloadMessages,
              opinions: partial.opinions as ModelOpinion[],
              partialPayload: partial,
            });
            setSynthRetryError(parsed.error || "Synthesis failed.");
            setSynthRetryModel(synthesizerModel);
            setSynthRetryOpen(true);
            setProgressMsg("");
            setBusy(false);
            try {
              await persistConversation(workingMessages, partial, workingConversationId);
            } catch { /* best effort */ }
            return;
          } else if (parsed.type === "error") {
            throw new Error(parsed.error || "Unknown stream error");
          }
        }
      }

      if (!finalResult) {
        throw new Error("No final result received from the server.");
      }

      setProgressMsg("");
      setLastRun(finalResult);
      workingMessages = [
        ...workingMessages,
        {
          id: makeId(),
          role: "assistant",
          content: finalResult.consensus,
        },
      ];
      setMessages(workingMessages);

      try {
        await persistConversation(workingMessages, finalResult, workingConversationId);
      } catch (historySaveError) {
        setHistoryError(
          historySaveError instanceof Error
            ? historySaveError.message
            : "Unable to save the conversation history.",
        );
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to complete the llmgps run.",
      );
      setProgressMsg("");
    } finally {
      setBusy(false);
    }
  }

  async function retrySynthesis() {
    if (!synthRetryContext || !synthRetryModel) return;

    setSynthRetryBusy(true);
    setSynthRetryError(null);

    try {
      const response = await fetch("/api/gps/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: synthRetryContext.messages,
          opinions: synthRetryContext.opinions,
          synthesizerModel: synthRetryModel,
          mode: synthRetryContext.partialPayload.mode,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 401) {
          await refreshAppStatus().catch(() => undefined);
          throw new Error("Session expired. Please log in again.");
        }
        throw new Error(data.error || `HTTP error ${response.status}`);
      }

      const data = (await response.json()) as { consensus: string };
      const finalPayload: GpsResponsePayload = {
        ...synthRetryContext.partialPayload,
        consensus: data.consensus,
      };

      setLastRun(finalPayload);
      setSynthesizerModel(synthRetryModel);

      const nextMessages: UiMessage[] = [
        ...messages,
        { id: makeId(), role: "assistant", content: data.consensus },
      ];
      setMessages(nextMessages);
      setSynthRetryOpen(false);
      setSynthRetryContext(null);

      try {
        await persistConversation(nextMessages, finalPayload, conversationId);
      } catch { /* best effort */ }
    } catch (retryError) {
      setSynthRetryError(
        retryError instanceof Error ? retryError.message : "Synthesis retry failed.",
      );
    } finally {
      setSynthRetryBusy(false);
    }
  }

  const trimmedSetupUsername = setupForm.username.trim();
  const setupPasswordFilled = setupForm.password.length > 0;
  const setupConfirmFilled = setupForm.confirmPassword.length > 0;
  const setupPasswordsMatch =
    setupConfirmFilled && setupForm.password === setupForm.confirmPassword;
  const setupReadiness = [
    trimmedSetupUsername.length > 0,
    setupPasswordFilled,
    setupPasswordsMatch,
  ].filter(Boolean).length;
  const loginUsername = loginForm.username.trim();
  const loginReady = loginUsername.length > 0 && loginForm.password.length > 0;
  const suggestedUsername = status.username || setupForm.username.trim();

  if (authView !== "app") {
    const showSetup = authView === "setup";
    const authStatusLabel = authView === "loading"
      ? t.auth.checkingWorkspace
      : showSetup
        ? t.auth.setupReady(setupReadiness)
        : loginReady
          ? t.auth.readyToSignIn
          : t.auth.enterCredentials;

    return (
      <main
        data-theme={theme}
        className="theme-shell min-h-[100dvh] overflow-hidden bg-[var(--background)] text-[var(--foreground)]"
      >
        <div className="relative mx-auto flex min-h-[100dvh] max-w-4xl items-center justify-center px-6 py-8">
          <div className="pointer-events-none absolute left-[12%] top-24 h-36 w-36 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-24 right-[14%] h-40 w-40 rounded-full bg-amber-400/8 blur-3xl" />

          <div className="panel-fade-in relative z-10 w-full max-w-xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">llmgps</div>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                  {authView === "loading"
                    ? t.auth.loadingWorkspace
                    : showSetup
                      ? t.auth.createOwnerAccount
                      : t.auth.signIn}
                </h1>
              </div>
              <button
                type="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
              >
                {theme === "dark" ? t.auth.lightTheme : t.auth.darkTheme}
              </button>
            </div>

            <section className="panel-fade-in rounded-[32px] border border-[var(--border)] bg-[var(--surface-color)] p-8 shadow-sm md:p-10">
              <div className="mb-8 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    {showSetup ? t.auth.setup : authView === "loading" ? t.auth.boot : t.auth.login}
                  </span>
                  <div className="h-px w-10 bg-[var(--border)]" />
                  <span className="text-sm text-[var(--muted)]">{authStatusLabel}</span>
                </div>
                {authView !== "loading" ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (showSetup) {
                        setShowSetupPasswords((current) => !current);
                      } else {
                        setShowLoginPassword((current) => !current);
                      }
                    }}
                    className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                  >
                    {showSetup
                      ? showSetupPasswords
                        ? t.auth.hidePasswords
                        : t.auth.showPasswords
                      : showLoginPassword
                        ? t.auth.hidePassword
                        : t.auth.showPassword}
                  </button>
                ) : null}
              </div>

              {authView === "loading" ? (
                <div className="space-y-5">
                  <p className="text-[15px] text-[var(--muted)]">
                    {t.auth.checkingSetup}
                  </p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                    <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--foreground)]/70" />
                  </div>
                  {authError ? (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                      {authError}
                    </div>
                  ) : null}
                </div>
              ) : showSetup ? (
                <form className="space-y-5" onSubmit={handleSetup}>
                  <p className="max-w-md text-[15px] leading-relaxed text-[var(--muted)]">
                    {t.auth.createFirstAccount}
                  </p>

                  {authError ? (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                      {authError}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t.auth.username}</label>
                    <input
                      type="text"
                      value={setupForm.username}
                      onChange={(event) =>
                        setSetupForm((current) => ({ ...current, username: event.target.value }))
                      }
                      className="w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-[15px] outline-none transition-colors focus:border-[var(--muted)]"
                      autoComplete="username"
                      placeholder="owner"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t.auth.password}</label>
                      <input
                        type={showSetupPasswords ? "text" : "password"}
                        value={setupForm.password}
                        onChange={(event) =>
                          setSetupForm((current) => ({ ...current, password: event.target.value }))
                        }
                        className="w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-[15px] outline-none transition-colors focus:border-[var(--muted)]"
                        autoComplete="new-password"
                        placeholder={t.auth.createPasswordPlaceholder}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t.auth.confirmPassword}</label>
                      <input
                        type={showSetupPasswords ? "text" : "password"}
                        value={setupForm.confirmPassword}
                        onChange={(event) =>
                          setSetupForm((current) => ({
                            ...current,
                            confirmPassword: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-[15px] outline-none transition-colors focus:border-[var(--muted)]"
                        autoComplete="new-password"
                        placeholder={t.auth.repeatPasswordPlaceholder}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-1">
                    <p className="text-sm text-[var(--muted)]">
                      {setupPasswordsMatch
                        ? t.auth.passwordsMatch
                        : setupConfirmFilled
                          ? t.auth.passwordsNoMatch
                          : t.auth.keepPassword}
                    </p>
                    <button
                      type="submit"
                      disabled={authBusy}
                      className="rounded-2xl bg-[var(--foreground)] px-5 py-3 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {authBusy ? t.auth.creatingOwner : t.auth.createOwnerBtn}
                    </button>
                  </div>
                </form>
              ) : (
                <form className="space-y-5" onSubmit={handleLogin}>
                  <p className="max-w-md text-[15px] leading-relaxed text-[var(--muted)]">
                    {t.auth.signInDesc}
                  </p>

                  {authError ? (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                      {authError}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t.auth.username}</label>
                    <input
                      type="text"
                      value={loginForm.username}
                      onChange={(event) =>
                        setLoginForm((current) => ({ ...current, username: event.target.value }))
                      }
                      className="w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-[15px] outline-none transition-colors focus:border-[var(--muted)]"
                      autoComplete="username"
                      placeholder={t.auth.enterUsername}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">{t.auth.password}</label>
                      {suggestedUsername ? (
                        <button
                          type="button"
                          onClick={() =>
                            setLoginForm((current) => ({ ...current, username: suggestedUsername }))
                          }
                          className="text-xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                        >
                          {t.auth.useUsername(suggestedUsername)}
                        </button>
                      ) : null}
                    </div>
                    <input
                      type={showLoginPassword ? "text" : "password"}
                      value={loginForm.password}
                      onChange={(event) =>
                        setLoginForm((current) => ({ ...current, password: event.target.value }))
                      }
                      className="w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-[15px] outline-none transition-colors focus:border-[var(--muted)]"
                      autoComplete="current-password"
                      placeholder={t.auth.enterPassword}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-1">
                    <p className="text-sm text-[var(--muted)]">
                      {loginReady
                        ? t.auth.readyWhenYouAre
                        : suggestedUsername
                          ? t.auth.ownerDetected(suggestedUsername)
                          : t.auth.useOwnerAccount}
                    </p>
                    <button
                      type="submit"
                      disabled={authBusy}
                      className="rounded-2xl bg-[var(--foreground)] px-5 py-3 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {authBusy ? t.auth.signingIn : t.auth.signInBtn}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      data-theme={theme}
      className="theme-shell flex min-h-[100dvh] bg-[var(--background)] text-[var(--foreground)]"
    >
      <aside className="flex w-20 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface-color)] md:w-64">
        <div className="border-b border-[var(--border)] px-4 py-5">
          <div className="llmgps-title">llmgps</div>
        </div>

        <div className="flex flex-1 flex-col gap-1 p-2 md:p-3">
          {sidebarItems.map((item) => {
            const active = item.id === "settings"
              ? activeView === "settings" || activeView === "apikeys"
              : activeView === item.id;
            const label = item.id === "chat" ? t.sidebar.chat : item.id === "runs" ? t.sidebar.chatHistory : t.sidebar.settings;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                title={label}
                className={cx(
                  "flex items-center gap-3 rounded-lg p-3 text-left text-sm transition-colors md:px-3 md:py-2.5",
                  active
                    ? "bg-[var(--surface)] font-medium text-[var(--foreground)]"
                    : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]",
                )}
              >
                <span className="text-xl md:text-lg">{item.emoji}</span>
                <span className="hidden md:block">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-1 border-t border-[var(--border)] p-2 md:p-3">
          <div className="hidden rounded-lg px-3 py-2 text-xs text-[var(--muted)] md:block">
            {t.sidebar.signedInAs} {status.username}
          </div>
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle theme"
            className="flex items-center gap-3 rounded-lg p-3 text-left text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)] md:px-3 md:py-2.5"
          >
            <span className="text-xl md:text-lg">{theme === "dark" ? "☀️" : "🌙"}</span>
            <span className="hidden md:block">{theme === "dark" ? t.sidebar.lightTheme : t.sidebar.darkTheme}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="flex items-center gap-3 rounded-lg p-3 text-left text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)] md:px-3 md:py-2.5"
          >
            <span className="text-xl md:text-lg">⇠</span>
            <span className="hidden md:block">{t.sidebar.logOut}</span>
          </button>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col bg-[var(--background)]">
        {status.shouldPromptForApiKeys ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm">
            <div className="panel-fade-in w-full max-w-lg rounded-[28px] border border-[var(--border)] bg-[var(--surface-color)] p-8 shadow-xl">
              <div className="space-y-4">
                <div>
                  <div className="text-sm uppercase tracking-[0.25em] text-[var(--muted)]">First Login</div>
                  <h2 className="mt-2 text-2xl font-semibold">{t.chat.addApiKeysTitle}</h2>
                </div>
                <p className="text-[15px] leading-relaxed text-[var(--muted)]">
                  {t.chat.addApiKeysDesc}
                </p>
                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => void handleOnboardingChoice(true)}
                    disabled={settingsBusy === "onboarding"}
                    className="rounded-2xl bg-[var(--foreground)] px-5 py-3 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {t.chat.goToSettings}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleOnboardingChoice(false)}
                    disabled={settingsBusy === "onboarding"}
                    className="rounded-2xl border border-[var(--border)] px-5 py-3 text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                  >
                    {t.chat.maybeLater}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activeView === "chat" ? (
          <div key="view-chat" className="panel-fade-in relative mx-auto flex h-full w-full max-w-3xl flex-col px-4 sm:px-6">
            <div className="flex items-center justify-between border-b border-[var(--border)] py-4">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{t.chat.currentChat}</div>
                <div className="mt-1 text-sm text-[var(--foreground)]">
                  {activeConversationSummary?.title || t.chat.newConversation}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveView("runs")}
                  className="rounded-full border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                >
                  {t.chat.chatHistoryBtn}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHistoryError(null);
                    resetConversationState({ clearConversationId: true });
                  }}
                  className="rounded-full border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                >
                  {t.chat.newChat}
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto scroll-smooth py-6 pb-40">
              {messages.length === 0 ? (
                <div className="flex min-h-full items-center justify-center">
                  <h1
                    className="text-5xl font-semibold tracking-[-0.04em] text-center sm:text-7xl"
                    style={{ opacity: welcomeFading ? 0 : 1, transition: "opacity 1.4s ease", lineHeight: 0.95, textWrap: "balance" }}
                  >
                    {activeWelcomePrompt}
                  </h1>
                </div>
              ) : (
                (() => {
                  const elements: React.ReactNode[] = [];
                  let opinionGroup: UiMessage[] = [];
                  // Collect "thought process" nodes that will be collapsed once synthesis is done
                  let thoughtNodes: React.ReactNode[] = [];
                  let synthesized = false;

                  function flushOpinions() {
                    if (opinionGroup.length === 0) return;
                    const group = opinionGroup;
                    opinionGroup = [];
                    const phase = group[0].phase === "debate" ? "Debate" : "Opinions";
                    thoughtNodes.push(
                      <div key={`opinions-${group[0].id}`} className="message-entry flex flex-col gap-1">
                        <span className="px-1 text-xs font-semibold text-[var(--muted)]">
                          {phase} ({group.length} models)
                        </span>
                        <div className="max-w-[90%] rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-color)] sm:max-w-[85%]">
                          {group.map((op, i) => (
                            <div
                              key={op.id}
                              className={cx(
                                "flex items-baseline gap-2 px-3 py-1.5 text-xs",
                                i > 0 && "border-t border-[var(--border)]",
                              )}
                            >
                              <span className="shrink-0 font-semibold text-[var(--muted)]">{op.modelLabel}</span>
                              <span className="truncate italic text-[var(--muted)] opacity-80">
                                {op.content.split("\n")[0].replace(/[*#`]/g, "")}
                              </span>
                              <button
                                type="button"
                                onClick={() => void copyToClipboard(op.content, op.id)}
                                className="ml-auto shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                                title="Copy opinion"
                              >
                                {copiedMessageId === op.id ? "✓" : "📋"}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>,
                    );
                  }

                  function flushThoughts(beforeKey: string) {
                    if (thoughtNodes.length === 0) return;
                    const nodes = thoughtNodes;
                    thoughtNodes = [];
                    synthesized = true;
                    elements.push(
                      <div key={`thoughts-${beforeKey}`}>
                        <button
                          type="button"
                          onClick={() => setThoughtsExpanded((v) => !v)}
                          className="flex items-center gap-1.5 px-1 py-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                        >
                          <span
                            className="inline-block transition-transform"
                            style={{ transform: thoughtsExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                          >
                            ▸
                          </span>
                          {thoughtsExpanded ? t.chat.collapseThoughts : t.chat.expandThoughts}
                        </button>
                        {thoughtsExpanded ? (
                          <div className="mt-2 space-y-4">{nodes}</div>
                        ) : null}
                      </div>,
                    );
                  }

                  for (const message of messages) {
                    if (message.isOpinion) {
                      if (opinionGroup.length > 0 && opinionGroup[0].phase !== message.phase) {
                        flushOpinions();
                      }
                      opinionGroup.push(message);
                      continue;
                    }
                    flushOpinions();

                    // Non-opinion assistant message after thought nodes = synthesis done
                    if (message.role === "assistant" && thoughtNodes.length > 0) {
                      // Also inject web search results into thoughts if present
                      if (webSearchResults.length > 0) {
                        thoughtNodes.push(
                          <div key="websearch-thoughts" className="message-entry flex flex-col gap-1">
                            <span className="px-1 text-xs font-semibold text-[var(--muted)]">
                              🔍 Web Search ({webSearchResults.length} results)
                            </span>
                            <div className="max-w-[90%] rounded-xl border border-[var(--border)] bg-[var(--surface-color)] sm:max-w-[85%]">
                              {webSearchResults.map((result, i) => {
                                let displayUrl: string;
                                try {
                                  displayUrl = new URL(result.url).hostname;
                                } catch {
                                  displayUrl = result.url;
                                }
                                return (
                                  <div
                                    key={i}
                                    className={cx(
                                      "px-3 py-2",
                                      i > 0 && "border-t border-[var(--border)]",
                                    )}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold text-[var(--foreground)]">{result.title}</span>
                                    </div>
                                    <div className="text-[11px] text-cyan-500">{displayUrl}</div>
                                    <div className="mt-0.5 line-clamp-1 text-xs text-[var(--muted)]">{result.snippet}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>,
                        );
                      }
                      flushThoughts(message.id);
                    }

                    elements.push(
                      <div
                        key={message.id}
                        className={cx("message-entry flex flex-col gap-1", message.role === "assistant" ? "" : "items-end")}
                      >
                        <span className="px-1 text-xs font-semibold text-[var(--muted)]">
                          {message.role === "assistant" ? "llmgps" : "You"}
                        </span>
                        <div
                          className={cx(
                            "max-w-[90%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed sm:max-w-[85%]",
                            message.role === "assistant"
                              ? "markdown-body border border-[var(--border)] bg-[var(--surface-color)]"
                              : "bg-[var(--foreground)] text-[var(--background)]",
                          )}
                        >
                          {message.role === "assistant" ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                          ) : (
                            <p className="whitespace-pre-wrap">{message.content}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void copyToClipboard(message.content, message.id)}
                          className="group px-1 py-2 text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                          title="Copy message"
                        >
                          <span className="text-sm group-hover:hidden">
                            {copiedMessageId === message.id ? "✓" : "📋"}
                          </span>
                          <span className="hidden text-xs group-hover:inline">
                            {copiedMessageId === message.id ? "✓ Copied" : "📋 Copy"}
                          </span>
                        </button>
                      </div>,
                    );
                  }
                  // If there are unflushed opinions (synthesis not done yet / still streaming), show them directly
                  flushOpinions();
                  if (thoughtNodes.length > 0 && !synthesized) {
                    elements.push(...thoughtNodes);
                    thoughtNodes = [];
                  }

                  return elements;
                })()
              )}
              {webSearchResults.length > 0 && !lastRun?.consensus ? (
                <div className="message-entry flex flex-col gap-1">
                  <span className="px-1 text-xs font-semibold text-[var(--muted)]">
                    🔍 Web Search ({webSearchResults.length} results)
                  </span>
                  <div className="max-w-[90%] rounded-xl border border-[var(--border)] bg-[var(--surface-color)] sm:max-w-[85%]">
                    {webSearchResults.map((result, i) => {
                      let displayUrl: string;
                      try {
                        displayUrl = new URL(result.url).hostname;
                      } catch {
                        displayUrl = result.url;
                      }
                      return (
                        <div
                          key={i}
                          className={cx(
                            "px-3 py-2",
                            i > 0 && "border-t border-[var(--border)]",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[var(--foreground)]">{result.title}</span>
                          </div>
                          <div className="text-[11px] text-cyan-500">{displayUrl}</div>
                          <div className="mt-0.5 line-clamp-1 text-xs text-[var(--muted)]">{result.snippet}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {busy ? (
                <div className="message-entry flex flex-col gap-1 items-start">
                  <span className="px-1 text-xs font-semibold text-[var(--muted)]">
                    llmgps {progressMsg ? `- ${progressMsg}` : "Routing your prompt across models…"}
                  </span>
                  <div className="max-w-[85%] rounded-2xl border border-[var(--border)] bg-[var(--surface-color)] px-4 py-3 text-[15px]">
                    <p className="animate-pulse">{progressMsg || "Working..."}</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[var(--background)] via-[var(--background)] to-transparent px-4 pb-6 pt-12 sm:px-6">
              {historyError ? (
                <div className="mb-3 w-full rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-600">
                  {historyError}
                </div>
              ) : null}

              {error ? (
                <div className="mb-3 w-full rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-500">
                  {error}
                </div>
              ) : null}

              <div className="relative flex w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-color)] shadow-sm transition-colors focus-within:border-[var(--muted)]">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Message llmgps…"
                  className="min-h-[56px] max-h-[200px] w-full resize-none border-none bg-transparent p-4 text-[15px] outline-none"
                  rows={1}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                />
                <div className="flex items-center justify-between px-3 pb-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const next = !gpsMode;
                        setGpsMode(next);
                        if (next) setDebateMode(false);
                      }}
                      className={cx(
                        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        gpsMode
                          ? "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]"
                          : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]",
                      )}
                    >
                      <span
                        className={cx(
                          "h-1.5 w-1.5 rounded-full",
                          gpsMode ? "bg-[var(--foreground)]" : "bg-[var(--muted)]",
                        )}
                      />
                      {t.chat.gpsMode}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !debateMode;
                        setDebateMode(next);
                        if (next) setGpsMode(false);
                      }}
                      className={cx(
                        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        debateMode
                          ? "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]"
                          : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]",
                      )}
                      title="Cross-reference model answers before synthesizing"
                    >
                      <span
                        className={cx(
                          "h-1.5 w-1.5 rounded-full",
                          debateMode ? "bg-amber-500" : "bg-[var(--muted)]",
                        )}
                      />
                      {t.chat.debateMode}
                    </button>
                    {compressionEnabled && compressedContext && (
                      <div
                        className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1 text-xs font-medium text-emerald-500"
                        title="Rolling compressed context is active for this conversation"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {t.chat.rolling}
                      </div>
                    )}
                    {webSearchConfig.enabled && webSearchConfig.apiKey?.trim() ? (
                      <button
                        type="button"
                        onClick={() => setWebSearchEnabled((v) => !v)}
                        className={cx(
                          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                          webSearchEnabled
                            ? "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]"
                            : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]",
                        )}
                        title="Search the web before responding"
                      >
                        <span
                          className={cx(
                            "h-1.5 w-1.5 rounded-full",
                            webSearchEnabled ? "bg-cyan-500" : "bg-[var(--muted)]",
                          )}
                        />
                        {t.chat.webSearch}
                      </button>
                    ) : null}
                    <div className="flex items-center px-2 py-1 text-xs text-[var(--muted)]">
                      {t.chat.responders(responderModels.length)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={busy || !draft.trim()}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--background)] transition-opacity focus:outline-none disabled:opacity-30"
                  >
                    ↑
                  </button>
                </div>
              </div>
              <div className="mt-2 text-center text-xs text-[var(--muted)]">
                Large Language Models can make mistakes. Consider verifying important information.
              </div>
            </div>
          </div>
        ) : null}

        {activeView === "settings" ? (
          <div key="view-settings" className="panel-fade-in h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl space-y-10 px-6 py-10">
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold">{t.settings.title}</h2>
                <p className="text-[15px] text-[var(--muted)]">
                  {t.settings.desc}
                </p>
                {settingsNotice ? (
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">
                    {settingsNotice}
                  </div>
                ) : null}
                {error ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                    {error}
                  </div>
                ) : null}
              </div>

              <section className="space-y-4">
                <h3 className="border-b border-[var(--border)] pb-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t.settings.language}
                </h3>
                <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5">
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value as Language)}
                    className="flex-1 appearance-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-[15px] outline-none transition-colors focus:border-[var(--muted)]"
                  >
                    <option value="auto">{t.settings.languageAuto}</option>
                    <option value="en">{t.settings.languageEn}</option>
                    <option value="zh">{t.settings.languageZh}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void saveLanguageSettings()}
                    disabled={settingsBusy !== null && settingsBusy !== "language"}
                    className="rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {settingsBusy === "language" ? t.settings.savingLanguage : t.settings.saveLanguage}
                  </button>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="border-b border-[var(--border)] pb-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t.settings.providersAndModels}
                </h3>
                <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5">
                  <div>
                    <div className="font-medium text-[15px]">{t.settings.manageApiKeys}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">{t.settings.manageApiKeysDesc}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveView("apikeys")}
                    className="shrink-0 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
                  >
                    {t.settings.goToApiKeys}
                  </button>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="border-b border-[var(--border)] pb-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t.settings.gpsRouting}
                </h3>

                {availableModels.length === 0 ? (
                  <p className="py-4 text-[15px] text-[var(--muted)]">
                    {t.settings.gpsRoutingHint}
                  </p>
                ) : (
                  <div className="mt-4 space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5">
                    <p className="text-sm text-[var(--muted)]">
                      {t.settings.routingDefaults}
                    </p>
                    <div>
                      <label className="mb-3 block text-sm font-medium">{t.settings.responders}</label>
                      <div className="flex flex-wrap gap-2">
                        {availableModels.map((model) => {
                          const selected = responderModels.some(
                            (entry) =>
                              serializeModelSelection(entry) === serializeModelSelection(model),
                          );
                          const providerTaken = !selected && responderModels.some(
                            (entry) => entry.providerId === model.providerId,
                          );
                          return (
                            <button
                              key={serializeModelSelection(model)}
                              type="button"
                              onClick={() => toggleResponderModel(model)}
                              className={cx(
                                "rounded-full border px-4 py-2 text-sm transition-colors",
                                selected
                                  ? "border-[var(--foreground)] bg-[var(--foreground)] font-medium text-[var(--background)]"
                                  : providerTaken
                                    ? "border-[var(--border)] bg-[var(--background)] text-[var(--muted)] opacity-40 cursor-not-allowed"
                                    : "border-[var(--border)] bg-[var(--background)] text-[var(--muted)] hover:border-[var(--muted)] hover:text-[var(--foreground)]",
                              )}
                            >
                              {model.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="pt-2">
                      <label className="mb-3 block text-sm font-medium">{t.settings.synthesizerModel}</label>
                      <select
                        value={synthesizerModel ? serializeModelSelection(synthesizerModel) : ""}
                        onChange={(event) => {
                          const nextModel = availableModels.find(
                            (model) => serializeModelSelection(model) === event.target.value,
                          );
                          setSynthesizerModel(nextModel || null);
                        }}
                        className="w-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-[15px] outline-none transition-colors focus:border-[var(--muted)]"
                      >
                        {availableModels.map((model) => (
                          <option
                            key={serializeModelSelection(model)}
                            value={serializeModelSelection(model)}
                          >
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="pt-2">
                      <label className="mb-1 block text-sm font-medium">{t.settings.searchQueryModel}</label>
                      <p className="mb-2 text-xs text-[var(--muted)]">{t.settings.searchQueryModelDesc}</p>
                      <select
                        value={searchQueryModel ? serializeModelSelection(searchQueryModel) : ""}
                        onChange={(event) => {
                          const nextModel = availableModels.find(
                            (model) => serializeModelSelection(model) === event.target.value,
                          );
                          setSearchQueryModel(nextModel ?? null);
                        }}
                        className="w-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-[15px] outline-none transition-colors focus:border-[var(--muted)]"
                      >
                        <option value="">{t.settings.noModel}</option>
                        {availableModels.map((model) => (
                          <option
                            key={serializeModelSelection(model)}
                            value={serializeModelSelection(model)}
                          >
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="pt-2">
                      <label className="mb-1 block text-sm font-medium">{t.settings.compressionModelLabel}</label>
                      <p className="mb-2 text-xs text-[var(--muted)]">{t.settings.compressionModelDesc}</p>
                      <select
                        value={compressionModel ? serializeModelSelection(compressionModel) : ""}
                        onChange={(event) => {
                          const nextModel = availableModels.find(
                            (model) => serializeModelSelection(model) === event.target.value,
                          );
                          setCompressionModel(nextModel ?? null);
                        }}
                        className="w-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-[15px] outline-none transition-colors focus:border-[var(--muted)]"
                      >
                        <option value="">{t.settings.usesSynthesizer}</option>
                        {availableModels.map((model) => (
                          <option
                            key={serializeModelSelection(model)}
                            value={serializeModelSelection(model)}
                          >
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        type="button"
                        onClick={() => void saveRoutingPreferences()}
                        disabled={settingsBusy !== null && settingsBusy !== "routing"}
                        className="rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {settingsBusy === "routing" ? t.settings.savingDefaults : t.settings.saveRoutingDefaults}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-4 pb-6">
                <h3 className="border-b border-[var(--border)] pb-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t.settings.contextCompression}
                </h3>

                <div className="mt-4 space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium">{t.settings.enableCompression}</label>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {t.settings.compressionDesc}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCompressionEnabled((v) => !v)}
                      className={cx(
                        "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
                        compressionEnabled ? "bg-[var(--foreground)]" : "bg-[var(--border)]",
                      )}
                    >
                      <span
                        className={cx(
                          "inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200",
                          compressionEnabled ? "translate-x-4" : "translate-x-0",
                        )}
                      />
                    </button>
                  </div>

                  {compressionEnabled && (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-sm font-medium">{t.settings.rollingContext}</label>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">
                            {t.settings.rollingContextDesc}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRollingContext((v) => !v)}
                          className={cx(
                            "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
                            rollingContext ? "bg-[var(--foreground)]" : "bg-[var(--border)]",
                          )}
                        >
                          <span
                            className={cx(
                              "inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200",
                              rollingContext ? "translate-x-4" : "translate-x-0",
                            )}
                          />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <label className="text-sm font-medium">{t.settings.targetTokenBudget}</label>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">
                            {t.settings.targetTokenDesc}
                          </p>
                        </div>
                        <input
                          type="number"
                          min={300}
                          max={8000}
                          step={100}
                          value={compressionTargetTokens}
                          onChange={(e) => setCompressionTargetTokens(Number(e.target.value))}
                          className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-right text-sm"
                        />
                      </div>

                    </>
                  )}

                  {compressionHistory.length > 0 && (
                    <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
                      <p className="text-xs font-medium text-[var(--muted)]">{t.settings.compressionHistoryTitle}</p>
                      {compressionHistory.map((round) => (
                        <div key={round.roundNumber} className="flex items-center justify-between text-xs text-[var(--muted)]">
                          <span>{t.settings.round} {round.roundNumber}</span>
                          <span>{round.originalTokenEstimate} → {round.compressedTokenEstimate} {t.settings.tokens}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => void saveRoutingPreferences()}
                      disabled={settingsBusy !== null && settingsBusy !== "routing"}
                      className="rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {settingsBusy === "routing" ? t.settings.savingCompression : t.settings.saveCompression}
                    </button>
                  </div>
                </div>
              </section>

              <section className="space-y-4 pb-20">
                <h3 className="border-b border-[var(--border)] pb-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t.settings.networkProxy}
                </h3>

                <div className="mt-4 space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">{t.settings.enableProxy}</label>
                    <button
                      type="button"
                      onClick={() =>
                        setProxyConfig((current) => ({ ...current, enabled: !current.enabled }))
                      }
                      className={cx(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none",
                        proxyConfig.enabled ? "bg-[var(--foreground)]" : "bg-[var(--muted)]",
                      )}
                    >
                      <span className="sr-only">{t.settings.useProxy}</span>
                      <span
                        aria-hidden="true"
                        className={cx(
                          "pointer-events-none absolute left-0 inline-block h-4 w-4 transform rounded-full bg-[var(--background)] shadow ring-0 transition-transform",
                          proxyConfig.enabled ? "translate-x-4" : "translate-x-0",
                        )}
                      />
                    </button>
                  </div>

                  {proxyConfig.enabled ? (
                    <div className="mt-4 grid gap-4 animate-in fade-in slide-in-from-top-2">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="mb-1 block text-xs text-[var(--muted)]">{t.settings.protocol}</label>
                          <select
                            value={proxyConfig.type}
                            onChange={(event) =>
                              setProxyConfig((current) => ({
                                ...current,
                                type: event.target.value as ProxyConfig["type"],
                              }))
                            }
                            className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
                          >
                            <option value="none">{t.settings.proxyDisabled}</option>
                            <option value="http">{t.settings.proxyHttp}</option>
                            <option value="socks5">{t.settings.proxySocks5}</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-[1fr_auto] gap-4">
                        <div>
                          <label className="mb-1 block text-xs text-[var(--muted)]">{t.settings.hostIp}</label>
                          <input
                            type="text"
                            placeholder="127.0.0.1"
                            value={proxyConfig.host}
                            onChange={(event) =>
                              setProxyConfig((current) => ({
                                ...current,
                                host: event.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
                          />
                        </div>
                        <div className="w-24">
                          <label className="mb-1 block text-xs text-[var(--muted)]">{t.settings.port}</label>
                          <input
                            type="text"
                            placeholder="1080"
                            value={proxyConfig.port}
                            onChange={(event) =>
                              setProxyConfig((current) => ({
                                ...current,
                                port: event.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="mb-1 block text-xs text-[var(--muted)]">
                            {t.settings.usernameOptional}
                          </label>
                          <input
                            type="text"
                            autoComplete="off"
                            placeholder="user"
                            value={proxyConfig.username}
                            onChange={(event) =>
                              setProxyConfig((current) => ({
                                ...current,
                                username: event.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-[var(--muted)]">
                            {t.settings.passwordOptional}
                          </label>
                          <input
                            type="password"
                            autoComplete="off"
                            placeholder="••••"
                            value={proxyConfig.password}
                            onChange={(event) =>
                              setProxyConfig((current) => ({
                                ...current,
                                password: event.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void saveProxySettings()}
                    disabled={settingsBusy !== null && settingsBusy !== "proxy"}
                    className="rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {settingsBusy === "proxy" ? t.settings.savingProxy : t.settings.saveProxy}
                  </button>
                </div>
              </section>

              <section className="space-y-4 pb-20">
                <h3 className="border-b border-[var(--border)] pb-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t.settings.webSearch}
                </h3>

                <div className="mt-4 space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium">{t.settings.enableWebSearch}</label>
                      <p className="text-xs text-[var(--muted)]">
                        {t.settings.webSearchDesc}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setWebSearchConfig((current) => ({ ...current, enabled: !current.enabled }))
                      }
                      className={cx(
                        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                        webSearchConfig.enabled ? "bg-green-500" : "bg-[var(--border)]",
                      )}
                    >
                      <span
                        className={cx(
                          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                          webSearchConfig.enabled ? "translate-x-5" : "translate-x-0",
                        )}
                      />
                    </button>
                  </div>

                  {webSearchConfig.enabled ? (
                    <div className="space-y-4">
                      <div>
                        <label className="mb-1 block text-xs text-[var(--muted)]">
                          {t.settings.searchProvider}
                        </label>
                        <select
                          value={webSearchConfig.provider}
                          onChange={(event) =>
                            setWebSearchConfig((current) => ({
                              ...current,
                              provider: event.target.value as "brave" | "tavily",
                            }))
                          }
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
                        >
                          <option value="brave">{t.settings.braveSearch}</option>
                          <option value="tavily">{t.settings.tavily}</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-[var(--muted)]">
                          {webSearchConfig.provider === "brave" ? t.settings.braveApiKey : t.settings.tavilyApiKey}
                        </label>
                        <input
                          type="password"
                          autoComplete="off"
                          placeholder={webSearchConfig.provider === "brave" ? "BSA..." : "tvly-..."}
                          value={webSearchConfig.apiKey}
                          onChange={(event) =>
                            setWebSearchConfig((current) => ({
                              ...current,
                              apiKey: event.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
                        />
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {webSearchConfig.provider === "brave" ? (
                            <>Get a free key at{" "}
                              <a href="https://brave.com/search/api/" target="_blank" rel="noopener noreferrer" className="underline">
                                brave.com/search/api
                              </a>
                              {" "}(2,000 req/month free).
                            </>
                          ) : (
                            <>Get a free key at{" "}
                              <a href="https://app.tavily.com/" target="_blank" rel="noopener noreferrer" className="underline">
                                app.tavily.com
                              </a>
                              {" "}(1,000 req/month free).
                            </>
                          )}
                        </p>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-[var(--muted)]">
                          {t.settings.maxResults}
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={webSearchConfig.maxResults}
                          onChange={(event) =>
                            setWebSearchConfig((current) => ({
                              ...current,
                              maxResults: Math.max(1, Math.min(10, Number(event.target.value) || 5)),
                            }))
                          }
                          className="w-24 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
                        />
                      </div>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void saveWebSearchSettings()}
                    disabled={settingsBusy !== null && settingsBusy !== "websearch"}
                    className="rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {settingsBusy === "websearch" ? t.settings.savingWebSearch : t.settings.saveWebSearch}
                  </button>
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {activeView === "apikeys" ? (
          <div key="view-apikeys" className="panel-fade-in h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl space-y-10 px-6 py-10">
              <div>
                <button
                  type="button"
                  onClick={() => setActiveView("settings")}
                  className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                >
                  {t.settings.apiKeysBackBtn}
                </button>
              </div>
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold">{t.settings.apiKeysTitle}</h2>
                <p className="text-[15px] text-[var(--muted)]">{t.settings.apiKeysDesc}</p>
                {settingsNotice ? (
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">
                    {settingsNotice}
                  </div>
                ) : null}
                {error ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                    {error}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4">
                {PROVIDER_PRESETS.map((provider) => {
                  const providerModels = customModels.filter(
                    (model) => model.providerId === provider.id,
                  );
                  const hasStoredKey = provider.authStrategy === "api-key" && configuredProviders.has(provider.id);
                  const hasOllamaEnabled = provider.id === "ollama" && ollamaConfig.enabled;
                  const providerDisplayName = (t.providers as Record<string, string>)[provider.id] || provider.name;

                  return (
                    <div
                      key={provider.id}
                      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5"
                    >
                      <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="font-medium text-[15px]">{providerDisplayName}</div>
                          <div className="mt-1 text-xs text-[var(--muted)]">
                            {provider.id === "ollama"
                              ? hasOllamaEnabled
                                ? t.settings.ollamaEnabled
                                : t.settings.ollamaDisabled
                              : hasStoredKey
                                ? t.settings.apiKeyStored
                                : t.settings.noApiKey}
                          </div>
                        </div>
                        {provider.docsUrl ? (
                          <a
                            href={provider.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-[var(--muted)] underline transition-colors hover:text-[var(--foreground)]"
                          >
                            {t.settings.docs}
                          </a>
                        ) : null}
                      </div>

                      <div className="space-y-4">
                        {provider.id === "custom" ? (
                          <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                            <div className="space-y-2">
                              <label className="text-xs text-[var(--muted)]">{t.settings.customEndpointUrl}</label>
                              <input
                                type="text"
                                placeholder={t.settings.customEndpointUrlPlaceholder}
                                value={customEndpointConfig.baseUrl}
                                onChange={(event) =>
                                  setCustomEndpointConfig({ baseUrl: event.target.value })
                                }
                                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-color)] px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--muted)]"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => void saveCustomEndpointSettings()}
                              disabled={settingsBusy !== null && settingsBusy !== "custom-endpoint"}
                              className="rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              {settingsBusy === "custom-endpoint" ? t.settings.savingEndpoint : t.settings.saveEndpoint}
                            </button>
                          </div>
                        ) : null}

                        {provider.authStrategy === "api-key" ? (
                          <div className="flex flex-col gap-3 sm:flex-row">
                            <input
                              type="password"
                              autoComplete="off"
                              placeholder={
                                hasStoredKey
                                  ? t.settings.apiKeyStoredPlaceholder
                                  : provider.apiKeyPlaceholder
                              }
                              value={apiKeyDrafts[provider.id]}
                              onChange={(event) =>
                                setApiKeyDrafts((current) => ({
                                  ...current,
                                  [provider.id]: event.target.value,
                                }))
                              }
                              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--muted)]"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => void saveProviderKey(provider.id)}
                                disabled={settingsBusy !== null && settingsBusy !== `key:${provider.id}`}
                                className="rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
                              >
                                {settingsBusy === `key:${provider.id}` ? t.settings.saving : t.settings.saveKey}
                              </button>
                              {hasStoredKey ? (
                                <button
                                  type="button"
                                  onClick={() => void removeProviderKey(provider.id)}
                                  disabled={settingsBusy !== null && settingsBusy !== `remove:${provider.id}`}
                                  className="rounded-xl border border-red-500/20 px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                                >
                                  {settingsBusy === `remove:${provider.id}` ? t.settings.removing : t.settings.remove}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-medium">{t.settings.enableOllama}</label>
                              <button
                                type="button"
                                onClick={() =>
                                  setOllamaConfig((current) => ({
                                    ...current,
                                    enabled: !current.enabled,
                                  }))
                                }
                                className={cx(
                                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none",
                                  ollamaConfig.enabled ? "bg-[var(--foreground)]" : "bg-[var(--muted)]",
                                )}
                              >
                                <span className="sr-only">{t.settings.toggleOllama}</span>
                                <span
                                  aria-hidden="true"
                                  className={cx(
                                    "pointer-events-none absolute left-0 inline-block h-4 w-4 transform rounded-full bg-[var(--background)] shadow ring-0 transition-transform",
                                    ollamaConfig.enabled ? "translate-x-4" : "translate-x-0",
                                  )}
                                />
                              </button>
                            </div>

                            <div className="flex items-center justify-between">
                              <div>
                                <label className="text-sm font-medium">{t.settings.ollamaBypassProxy}</label>
                                <p className="mt-0.5 text-xs text-[var(--muted)]">{t.settings.ollamaBypassProxyDesc}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setOllamaConfig((current) => ({
                                    ...current,
                                    bypassProxy: !current.bypassProxy,
                                  }))
                                }
                                className={cx(
                                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none",
                                  ollamaConfig.bypassProxy ? "bg-[var(--foreground)]" : "bg-[var(--muted)]",
                                )}
                              >
                                <span className="sr-only">{t.settings.ollamaBypassProxy}</span>
                                <span
                                  aria-hidden="true"
                                  className={cx(
                                    "pointer-events-none absolute left-0 inline-block h-4 w-4 transform rounded-full bg-[var(--background)] shadow ring-0 transition-transform",
                                    ollamaConfig.bypassProxy ? "translate-x-4" : "translate-x-0",
                                  )}
                                />
                              </button>
                            </div>

                            <div className="space-y-2">
                              <label className="text-xs text-[var(--muted)]">{t.settings.baseUrl}</label>
                              <input
                                type="text"
                                placeholder="http://127.0.0.1:11434"
                                value={ollamaConfig.baseUrl}
                                onChange={(event) =>
                                  setOllamaConfig((current) => ({
                                    ...current,
                                    baseUrl: event.target.value,
                                  }))
                                }
                                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-color)] px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--muted)]"
                              />
                            </div>

                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => void saveOllamaSettings()}
                                disabled={settingsBusy !== null && settingsBusy !== "ollama"}
                                className="rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
                              >
                                {settingsBusy === "ollama" ? t.settings.saving : t.settings.saveOllama}
                              </button>
                              <button
                                type="button"
                                onClick={() => void fetchOllamaModels()}
                                disabled={ollamaModelsBusy}
                                className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] disabled:opacity-50"
                              >
                                {ollamaModelsBusy ? t.settings.fetchingModels : t.settings.fetchModels}
                              </button>
                            </div>

                            {ollamaModelsError ? (
                              <p className="text-xs text-red-500">{ollamaModelsError}</p>
                            ) : null}

                            {ollamaModels.length > 0 ? (
                              <div className="space-y-2">
                                <p className="text-xs text-[var(--muted)]">{t.settings.ollamaModelsHint}</p>
                                <div className="flex flex-wrap gap-2">
                                  {ollamaModels.map((modelName) => {
                                    const sel = createCustomModelSelection("ollama", modelName);
                                    const key = serializeModelSelection(sel);
                                    const alreadyAdded = customModels.some((m) => serializeModelSelection(m) === key);
                                    return (
                                      <button
                                        key={modelName}
                                        type="button"
                                        disabled={alreadyAdded}
                                        onClick={() => {
                                          if (!alreadyAdded) setCustomModels((current) => [...current, sel]);
                                        }}
                                        className={cx(
                                          "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                                          alreadyAdded
                                            ? "border-[var(--border)] text-[var(--muted)] opacity-50 cursor-default"
                                            : "border-[var(--border)] hover:border-[var(--foreground)] hover:bg-[var(--surface-muted)] cursor-pointer",
                                        )}
                                      >
                                        {alreadyAdded ? "✓ " : "+ "}{modelName}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-2">
                          <input
                            value={customDrafts[provider.id] || ""}
                            onChange={(event) =>
                              setCustomDrafts((current) => ({
                                ...current,
                                [provider.id]: event.target.value,
                              }))
                            }
                            placeholder={t.settings.addModelPlaceholder}
                            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm outline-none transition-colors focus:border-[var(--muted)]"
                          />
                          <button
                            type="button"
                            onClick={() => addCustomModel(provider.id)}
                            className="rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90"
                          >
                            {t.settings.addCustomModel}
                          </button>
                        </div>

                        {providerModels.length > 0 ? (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {providerModels.map((model) => (
                              <button
                                key={serializeModelSelection(model)}
                                type="button"
                                onClick={() => removeCustomModel(model)}
                                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs transition-colors hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-500"
                              >
                                {model.modelId} ×
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {activeView === "runs" ? (
          <div key="view-runs" className="panel-fade-in h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-10 pb-20">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold">{t.history.title}</h2>
                  <p className="mt-1 text-[15px] text-[var(--muted)]">
                    {t.history.desc}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveView("chat");
                    resetConversationState({ clearConversationId: true });
                  }}
                  className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                >
                  {t.history.newChat}
                </button>
              </div>

              {historyError ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                  {historyError}
                </div>
              ) : null}

              <section className="space-y-4">
                <h3 className="border-b border-[var(--border)] pb-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t.history.conversations}
                </h3>

                {conversationHistory.length === 0 ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-8 text-center text-[15px] text-[var(--muted)]">
                    {historyBusy === "list"
                      ? t.history.loading
                      : t.history.empty}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {conversationHistory.map((conversation) => {
                      const selected = conversation.id === conversationId;

                      return (
                        <div
                          key={conversation.id}
                          className={cx(
                            "flex items-start justify-between gap-3 rounded-2xl border p-4 transition-colors",
                            selected
                              ? "border-[var(--foreground)] bg-[var(--surface-subtle)]"
                              : "border-[var(--border)] bg-[var(--surface-color)]",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => void loadConversation(conversation.id, { openChat: true })}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div className="truncate text-sm font-medium">{conversation.title}</div>
                              <div className="shrink-0 text-xs text-[var(--muted)]">
                                {new Date(conversation.updatedAt).toLocaleString()}
                              </div>
                            </div>
                            <div className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">
                              {conversation.preview || t.history.noPreview}
                            </div>
                            <div className="mt-3 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                              {t.history.savedMessages(conversation.messageCount)}
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => void deleteConversation(conversation.id)}
                            disabled={historyBusy === `delete:${conversation.id}`}
                            className="rounded-xl border border-red-500/20 px-3 py-2 text-xs text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                          >
                            {historyBusy === `delete:${conversation.id}` ? t.history.deleting : t.history.delete}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="space-y-4">
                <h3 className="border-b border-[var(--border)] pb-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t.history.selectedRun}
                </h3>

                {lastRun ? (
                  <div className="space-y-8">
                    <div className="flex gap-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5 text-[15px]">
                      <div className="flex flex-col">
                        <span className="mb-1 text-xs uppercase tracking-wider text-[var(--muted)]">Mode</span>
                        <span className="font-medium">{lastRun.mode.toUpperCase()}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="mb-1 text-xs uppercase tracking-wider text-[var(--muted)]">Opinions</span>
                        <span className="font-medium">{lastRun.opinions.length}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="mb-1 text-xs uppercase tracking-wider text-[var(--muted)]">Failures</span>
                        <span className="font-medium">{lastRun.failures.length}</span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="border-b border-[var(--border)] pb-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
                        Opinions
                      </h3>
                      {lastRun.opinions.length === 0 ? (
                        <div className="py-2 text-[15px] text-[var(--muted)]">No opinions collected.</div>
                      ) : null}
                      {lastRun.opinions.map((opinion) => (
                        <div
                          key={`${serializeModelSelection(opinion)}:${opinion.content.slice(0, 16)}`}
                          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5"
                        >
                          <div className="mb-3 w-fit rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-xs font-semibold text-[var(--foreground)]">
                            {opinion.label}
                          </div>
                          <div className="markdown-body text-[15px] leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{opinion.content}</ReactMarkdown>
                          </div>
                        </div>
                      ))}
                    </div>

                    {lastRun.failures.length > 0 ? (
                      <div className="space-y-4 pt-4">
                        <h3 className="border-b border-red-500/20 pb-2 text-sm font-semibold uppercase tracking-wider text-red-500/70">
                          Failures
                        </h3>
                        {lastRun.failures.map((failure) => (
                          <div
                            key={`${serializeModelSelection(failure)}:${failure.error}`}
                            className="rounded-2xl border border-red-500/10 bg-red-500/5 p-5"
                          >
                            <div className="mb-3 w-fit rounded-md border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-500">
                              {failure.label}
                            </div>
                            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--foreground)]/80">
                              {failure.error}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-8 text-center text-[15px] text-[var(--muted)]">
                    Open a saved conversation or run a new chat to inspect its latest GPS output here.
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : null}
      </div>

      {synthRetryOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl">
            <h2 className="text-lg font-semibold">{t.synthesis.failed}</h2>
            {synthRetryError ? (
              <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {synthRetryError}
              </p>
            ) : null}
            <p className="mt-3 text-sm text-[var(--muted)]">
              {t.synthesis.retryDesc}
            </p>

            <div className="mt-4 space-y-1">
              {availableModels.map((model) => {
                const key = serializeModelSelection(model);
                const selected = synthRetryModel ? serializeModelSelection(synthRetryModel) === key : false;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSynthRetryModel(model)}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "border border-[var(--border)] bg-[var(--surface-subtle)] font-medium text-[var(--foreground)]"
                        : "text-[var(--muted)] hover:bg-[var(--surface-color)] hover:text-[var(--foreground)]",
                    )}
                  >
                    <span className={cx("h-2 w-2 shrink-0 rounded-full", selected ? "bg-cyan-500" : "bg-transparent")} />
                    <span>{model.label}</span>
                    <span className="ml-auto text-xs text-[var(--muted)]">{model.providerId}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setSynthRetryOpen(false);
                  setSynthRetryContext(null);
                  setSynthRetryError(null);
                }}
                className="rounded-lg px-4 py-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
              >
                {t.synthesis.dismiss}
              </button>
              <button
                type="button"
                disabled={!synthRetryModel || synthRetryBusy}
                onClick={() => void retrySynthesis()}
                className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity disabled:opacity-40"
              >
                {synthRetryBusy ? t.synthesis.synthesizing : t.synthesis.retrySynthesis}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
