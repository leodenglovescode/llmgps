"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { GpsResponsePayload } from "@/lib/gps";
import {
  type ChatMessage,
  type ModelSelection,
  type ProviderId,
  PROVIDER_PRESETS,
  createCustomModelSelection,
  serializeModelSelection,
} from "@/lib/llm";

type ProxyConfig = {
  enabled: boolean;
  type: "http" | "socks5" | "none";
  host: string;
  port: string;
  username?: string;
  password?: string;
};

type ApiKeyState = Partial<Record<ProviderId, string>>;
type ThemeMode = "dark" | "light";
type ViewId = "chat" | "runs" | "settings";

type UiMessage = ChatMessage & {
  id: string;
  isOpinion?: boolean;
  modelLabel?: string;
  phase?: 'initial' | 'debate';
};

type PersistedState = {
  apiKeys: ApiKeyState;
  customModels: ModelSelection[];
  responderModels: ModelSelection[];
  synthesizerModel: ModelSelection | null;
  proxy?: ProxyConfig;
  debateMode?: boolean;
};

const defaultProxy: ProxyConfig = { enabled: false, type: "none", host: "", port: "", username: "", password: "" };

type SidebarItem = {
  id: ViewId;
  emoji: string;
  label: string;
};

const STORAGE_KEY = "llmgps-state";
const THEME_KEY = "llmgps-theme";

const sidebarItems: SidebarItem[] = [
  { id: "chat", emoji: "💬", label: "Chat" },
  { id: "runs", emoji: "🧾", label: "Runs" },
  { id: "settings", emoji: "⚙️", label: "Settings" },
];

const initialMessages: UiMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "Welcome to llmgps. Add API keys in Settings to connect providers, pick up to five responders, and choose a synthesizer model.",
  },
];

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function loadPersistedState(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as PersistedState : null;
  } catch {
    return null;
  }
}

function loadTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "light" ? "light" : "dark";
}

export function LlmgpsShell() {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [activeView, setActiveView] = useState<ViewId>("chat");
  const [apiKeys, setApiKeys] = useState<ApiKeyState>({});
  const [customModels, setCustomModels] = useState<ModelSelection[]>([]);
  const [customDrafts, setCustomDrafts] = useState<Record<ProviderId, string>>({
    anthropic: "",
    deepseek: "",
    gemini: "",
    openai: "",
    openrouter: "",
    xai: "",
  });
  const [responderModels, setResponderModels] = useState<ModelSelection[]>([]);
  const [synthesizerModel, setSynthesizerModel] = useState<ModelSelection | null>(null);
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>(defaultProxy);
  const [debateMode, setDebateMode] = useState<boolean>(false);
  const [progressMsg, setProgressMsg] = useState<string>("");
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [gpsMode, setGpsMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<GpsResponsePayload | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const persisted = loadPersistedState();
    if (persisted) {
      setApiKeys(persisted.apiKeys || {});
      setCustomModels(persisted.customModels || []);
      setResponderModels(persisted.responderModels || []);
      setSynthesizerModel(persisted.synthesizerModel || null);
      if (persisted.proxy) setProxyConfig(persisted.proxy);
      if (persisted.debateMode !== undefined) setDebateMode(persisted.debateMode);
    }
    setTheme(loadTheme());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme, hydrated]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const payload: PersistedState = {
      apiKeys,
      customModels,
      responderModels,
      synthesizerModel,
      proxy: proxyConfig,
      debateMode,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [apiKeys, customModels, responderModels, synthesizerModel, proxyConfig, debateMode, hydrated]);

  const connectedProviders = useMemo(
    () => PROVIDER_PRESETS.filter((p) => Boolean(apiKeys[p.id]?.trim())),
    [apiKeys],
  );

  const availableModels = useMemo(() => {
    const presets = connectedProviders.flatMap((p) =>
      p.models.map((m) => ({ providerId: m.providerId, modelId: m.modelId, label: m.label })),
    );
    const allModels = [...presets, ...customModels];
    
    const seen = new Set<string>();
    return allModels.filter((m) => {
      const key = serializeModelSelection(m);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [connectedProviders, customModels]);

  useEffect(() => {
    if (availableModels.length === 0) {
      setResponderModels([]);
      setSynthesizerModel(null);
      return;
    }

    const availableKeys = new Set(availableModels.map(serializeModelSelection));
    setResponderModels((current) => current.filter((m) => availableKeys.has(serializeModelSelection(m))));
    setSynthesizerModel((current) => {
      if (!current || !availableKeys.has(serializeModelSelection(current))) {
        return availableModels[0];
      }
      return current;
    });
  }, [availableModels]);

  function updateKey(providerId: ProviderId, value: string) {
    setApiKeys((current) => ({ ...current, [providerId]: value }));
  }

  function toggleResponderModel(model: ModelSelection) {
    const key = serializeModelSelection(model);
    setResponderModels((current) => {
      const exists = current.some((entry) => serializeModelSelection(entry) === key);
      if (exists) {
        return current.filter((entry) => serializeModelSelection(entry) !== key);
      }
      if (current.length >= 5) {
        setError("You can select up to 5 responder models.");
        return current;
      }
      setError(null);
      return [...current, model];
    });
  }

  function addCustomModel(providerId: ProviderId) {
    const modelId = customDrafts[providerId]?.trim();
    if (!modelId) return;

    const nextModel = createCustomModelSelection(providerId, modelId);
    const key = serializeModelSelection(nextModel);

    setCustomModels((current) => {
      if (current.some((entry) => serializeModelSelection(entry) === key)) return current;
      return [...current, nextModel];
    });

    setCustomDrafts((current) => ({ ...current, [providerId]: "" }));
  }

  function removeCustomModel(model: ModelSelection) {
    const key = serializeModelSelection(model);
    setCustomModels((current) => current.filter((entry) => serializeModelSelection(entry) !== key));
    setResponderModels((current) => current.filter((entry) => serializeModelSelection(entry) !== key));
    if (synthesizerModel && serializeModelSelection(synthesizerModel) === key) {
      setSynthesizerModel(null);
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
      setError("Choose a synthesizer model before using GPS Mode.");
      setActiveView("settings");
      return;
    }

    const nextUserMessage: UiMessage = {
      id: makeId(),
      role: "user",
      content: userPrompt,
    };

    const nextMessages = [...messages, nextUserMessage];

    let proxyUrl: string | undefined = undefined;
    if (proxyConfig.enabled && proxyConfig.type !== "none" && proxyConfig.host && proxyConfig.port) {
      if (proxyConfig.username || proxyConfig.password) {
        proxyUrl = `${proxyConfig.type}://${encodeURIComponent(proxyConfig.username || "")}:${encodeURIComponent(proxyConfig.password || "")}@${proxyConfig.host}:${proxyConfig.port}`;
      } else {
        proxyUrl = `${proxyConfig.type}://${proxyConfig.host}:${proxyConfig.port}`;
      }
    }

    const payloadMessages: ChatMessage[] = nextMessages
      .filter((msg) => !msg.isOpinion)
      .map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

    setMessages(nextMessages);
    setDraft("");
    setBusy(true);
    setError(null);

    try {
      setProgressMsg("Preparing request...");
      const response = await fetch("/api/gps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKeys,
          gpsMode,
          debateMode,
          messages: payloadMessages,
          responderModels,
          synthesizerModel,
          proxyUrl,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Stream not supported");

      const decoder = new TextDecoder();
      let streamData = "";
      let finalResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamData += decoder.decode(value, { stream: true });
        const lines = streamData.split('\n');
        streamData = lines.pop() || ""; // keep incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch (e) {
            console.error("Failed to parse stream line:", line, e);
            continue;
          }

          if (parsed.type === "progress") {
            setProgressMsg(parsed.message);
          } else if (parsed.type === "result") {
            finalResult = parsed.payload;
          } else if (parsed.type === "opinion") {
            setMessages((curr) => [
              ...curr, 
              { 
                id: makeId(), 
                role: "assistant", 
                content: parsed.content, 
                isOpinion: true, 
                modelLabel: parsed.model,
                phase: parsed.phase
              }
            ]);
          } else if (parsed.type === "error") {
            throw new Error(parsed.error || "Unknown stream error");
          }
        }
      }

      if (!finalResult) throw new Error("No final result received from the server.");
      const data = finalResult as GpsResponsePayload;
      setProgressMsg("");

      setLastRun(data);
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          content: data.consensus,
        },
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to complete the llmgps run.",
      );
      setProgressMsg("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main data-theme={theme} className="theme-shell flex h-[100dvh] w-full bg-[var(--background)] text-[var(--foreground)] overflow-hidden">
      
      {/* Sidebar - Clean, slim, flush left */}
      <aside className="w-[60px] md:w-[260px] shrink-0 flex flex-col bg-[var(--surface-subtle)] border-r border-[var(--border)] transition-all">
        <div className="flex-1 overflow-y-auto py-3 px-2 md:px-3 flex flex-col gap-1">
          {sidebarItems.map((item) => {
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                title={item.label}
                className={cx(
                  "flex items-center gap-3 rounded-lg p-3 md:px-3 md:py-2.5 text-left text-sm transition-colors",
                  active ? "bg-[var(--surface)] font-medium text-[var(--foreground)]" : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]",
                )}
              >
                <span className="text-xl md:text-lg">{item.emoji}</span>
                <span className="hidden md:block">{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="p-2 md:p-3 border-t border-[var(--border)] flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle theme"
            className="flex items-center gap-3 rounded-lg p-3 md:px-3 md:py-2.5 text-left text-sm transition-colors text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          >
            <span className="text-xl md:text-lg">{theme === "dark" ? "☀️" : "🌙"}</span>
            <span className="hidden md:block">{theme === "dark" ? "Light theme" : "Dark theme"}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full bg-[var(--background)] min-w-0">
        {activeView === "chat" ? (
          <div className="flex flex-col h-full w-full max-w-3xl mx-auto px-4 sm:px-6 relative">
            
            <div className="flex-1 overflow-y-auto space-y-6 py-6 scroll-smooth pb-40">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cx(
                    "flex flex-col gap-1",
                    message.role === "assistant" ? "" : "items-end",
                  )}
                >
                  <span className="font-semibold text-xs text-[var(--muted)] px-1">
                    {message.role === "assistant" ? (message.isOpinion ? `${message.modelLabel} ${message.phase === 'debate' ? '(Debating)' : '(Opinion)'}` : "llmgps") : "You"}
                  </span>
                  <div
                    className={cx(
                      "px-4 py-3 rounded-2xl max-w-[90%] sm:max-w-[85%] text-[15px] leading-relaxed",
                      message.role === "assistant"
                        ? message.isOpinion
                          ? "bg-[var(--surface-color)] border border-dashed border-[var(--border)] text-[var(--muted)] opacity-90 overflow-hidden"
                          : "bg-[var(--surface-color)] border border-[var(--border)] markdown-body"
                        : "bg-[var(--foreground)] text-[var(--background)]",
                    )}
                  >
                    {message.role === "assistant" ? (
                      message.isOpinion ? (
                        <div className="line-clamp-1 italic truncate">
                          {message.content.split('\n')[0].replace(/[*#`]/g, '')}
                        </div>
                      ) : (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      )
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                </div>
              ))}
              {busy ? (
                <div className="flex flex-col gap-1 items-start">
                  <span className="font-semibold text-xs text-[var(--muted)] px-1">
                    llmgps {progressMsg ? `- ${progressMsg}` : 'Routing your prompt across models…'}
                  </span>
                  <div className="px-4 py-3 rounded-2xl bg-[var(--surface-color)] border border-[var(--border)] text-[15px] max-w-[85%]">
                    <p className="animate-pulse">{progressMsg || "Working..."}</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[var(--background)] via-[var(--background)] to-transparent pt-12 pb-6 px-4 sm:px-6">
              {error ? (
                <div className="text-red-500 mb-3 px-4 py-2 bg-red-500/10 rounded-xl text-sm border border-red-500/20 w-full">
                  {error}
                </div>
              ) : null}
              
              <div className="relative flex flex-col bg-[var(--surface-color)] rounded-2xl border border-[var(--border)] focus-within:border-[var(--muted)] shadow-sm transition-colors overflow-hidden w-full">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Message llmgps…"
                  className="bg-transparent w-full resize-none outline-none border-none max-h-[200px] min-h-[56px] p-4 text-[15px]"
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
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
                        "text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium transition-colors border",
                         gpsMode ? "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                      )}
                    >
                      <span className={cx("w-1.5 h-1.5 rounded-full", gpsMode ? "bg-[var(--foreground)]" : "bg-[var(--muted)]")}></span>
                      GPS Mode
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !debateMode;
                        setDebateMode(next);
                        if (next) setGpsMode(false);
                      }}
                      className={cx(
                        "text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium transition-colors border",
                         debateMode ? "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                      )}
                      title="Cross-reference model answers before synthesizing"
                    >
                      <span className={cx("w-1.5 h-1.5 rounded-full", debateMode ? "bg-amber-500" : "bg-[var(--muted)]")}></span>
                      Debate Mode
                    </button>
                    <div className="text-xs px-2 py-1 text-[var(--muted)] flex items-center">
                       {responderModels.length} responders
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={busy || !draft.trim()}
                    className="bg-[var(--foreground)] text-[var(--background)] w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-30 transition-opacity focus:outline-none"
                  >
                    ↑
                  </button>
                </div>
              </div>
              <div className="text-center mt-2 text-xs text-[var(--muted)]">
                Large Language Models can make mistakes. Consider verifying important information.
              </div>
            </div>
          </div>
        ) : null}

        {activeView === "settings" ? (
          <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto w-full px-6 py-10 space-y-10">
              <h2 className="text-2xl font-semibold">Settings</h2>
              
              <section className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)] pb-2">Providers & Models</h3>
                
                <div className="grid gap-4 mt-4">
                  {PROVIDER_PRESETS.map((provider) => {
                    const providerModels = customModels.filter(
                      (model) => model.providerId === provider.id,
                    );

                    return (
                      <div key={provider.id} className="bg-[var(--surface-subtle)] border border-[var(--border)] rounded-2xl p-5">
                        <div className="flex items-center justify-between gap-4 mb-4">
                          <div className="font-medium text-[15px]">{provider.name}</div>
                          <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="text-xs underline text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">Docs</a>
                        </div>

                        <div className="space-y-4">
                          <input
                            type="password"
                            autoComplete="off"
                            placeholder={provider.apiKeyPlaceholder}
                            value={apiKeys[provider.id] || ""}
                            onChange={(event) => updateKey(provider.id, event.target.value)}
                            className="w-full bg-[var(--background)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--muted)] transition-colors"
                          />

                          <div className="flex flex-wrap gap-2">
                            {provider.models.map((model) => (
                              <span key={model.id} className="bg-[var(--surface-color)] border border-[var(--border)] rounded-md px-2 py-1 text-xs text-[var(--foreground)]/80">
                                {model.label}
                              </span>
                            ))}
                          </div>

                          <div className="flex gap-2 items-center pt-2">
                            <input
                              value={customDrafts[provider.id] || ""}
                              onChange={(event) => setCustomDrafts((c) => ({ ...c, [provider.id]: event.target.value }))}
                              placeholder="Add custom model ID (e.g. gpt-4-turbo)"
                              className="flex-1 bg-[var(--background)] border border-[var(--border)] rounded-xl px-4 py-2 text-sm outline-none focus:border-[var(--muted)] transition-colors"
                            />
                            <button
                              type="button"
                              onClick={() => addCustomModel(provider.id)}
                              className="bg-[var(--foreground)] text-[var(--background)] px-4 py-2 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                            >
                              Add
                            </button>
                          </div>
                          
                          {providerModels.length > 0 ? (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {providerModels.map((model) => (
                                <button
                                  key={serializeModelSelection(model)}
                                  type="button"
                                  onClick={() => removeCustomModel(model)}
                                  className="bg-[var(--background)] border border-[var(--border)] hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-500 rounded-md px-2 py-1 text-xs transition-colors"
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
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)] pb-2">GPS Routing</h3>
                
                {availableModels.length === 0 ? (
                  <p className="text-[15px] text-[var(--muted)] py-4">Add API keys above to unlock routing and conversation capabilities.</p>
                ) : (
                  <div className="space-y-6 mt-4 p-5 bg-[var(--surface-subtle)] border border-[var(--border)] rounded-2xl">
                    <div>
                      <label className="block text-sm font-medium mb-3">Responders (up to 5)</label>
                      <div className="flex flex-wrap gap-2">
                        {availableModels.map((model) => {
                          const selected = responderModels.some(
                            (entry) => serializeModelSelection(entry) === serializeModelSelection(model),
                          );
                          return (
                            <button
                              key={serializeModelSelection(model)}
                              type="button"
                              onClick={() => toggleResponderModel(model)}
                              className={cx(
                                "rounded-full px-4 py-2 text-sm transition-colors border",
                                selected ? "bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)] font-medium" : "bg-[var(--background)] border-[var(--border)] hover:border-[var(--muted)] text-[var(--muted)] hover:text-[var(--foreground)]"
                              )}
                            >
                              {model.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="pt-2">
                      <label className="block text-sm font-medium mb-3">Synthesizer Model</label>
                      <select
                        value={synthesizerModel ? serializeModelSelection(synthesizerModel) : ""}
                        onChange={(event) => {
                          const nextModel = availableModels.find(
                            (model) => serializeModelSelection(model) === event.target.value,
                          );
                          setSynthesizerModel(nextModel || null);
                        }}
                        className="w-full bg-[var(--background)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[15px] outline-none focus:border-[var(--muted)] transition-colors appearance-none"
                      >
                        {availableModels.map((model) => (
                          <option key={serializeModelSelection(model)} value={serializeModelSelection(model)}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-4 pb-20">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)] pb-2">Network Proxy</h3>
                
                <div className="space-y-4 mt-4 p-5 bg-[var(--surface-subtle)] border border-[var(--border)] rounded-2xl">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Enable Proxy</label>
                    <button
                      type="button"
                      onClick={() => setProxyConfig(c => ({ ...c, enabled: !c.enabled }))}
                      className={cx("relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none", proxyConfig.enabled ? "bg-[var(--foreground)]" : "bg-[var(--muted)]")}
                    >
                      <span className="sr-only">Use proxy</span>
                      <span aria-hidden="true" className={cx("pointer-events-none absolute left-0 inline-block h-4 w-4 transform rounded-full bg-[var(--background)] shadow ring-0 transition-transform", proxyConfig.enabled ? "translate-x-4" : "translate-x-0")} />
                    </button>
                  </div>

                  {proxyConfig.enabled && (
                    <div className="grid gap-4 mt-4 animate-in fade-in slide-in-from-top-2">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-[var(--muted)] mb-1">Protocol</label>
                          <select
                            value={proxyConfig.type}
                            onChange={(e) => setProxyConfig(c => ({ ...c, type: e.target.value as "http" | "socks5" | "none" }))}
                            className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--muted)] appearance-none"
                          >
                            <option value="none">Disabled</option>
                            <option value="http">HTTP / HTTPS</option>
                            <option value="socks5">SOCKS5</option>
                          </select>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-[1fr_auto] gap-4">
                        <div>
                          <label className="block text-xs text-[var(--muted)] mb-1">Host / IP</label>
                          <input
                            type="text"
                            placeholder="127.0.0.1"
                            value={proxyConfig.host}
                            onChange={(e) => setProxyConfig(c => ({ ...c, host: e.target.value }))}
                            className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
                          />
                        </div>
                        <div className="w-24">
                          <label className="block text-xs text-[var(--muted)] mb-1">Port</label>
                          <input
                            type="text"
                            placeholder="1080"
                            value={proxyConfig.port}
                            onChange={(e) => setProxyConfig(c => ({ ...c, port: e.target.value }))}
                            className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-[var(--muted)] mb-1">Username (Optional)</label>
                          <input
                            type="text"
                            autoComplete="off"
                            placeholder="user"
                            value={proxyConfig.username}
                            onChange={(e) => setProxyConfig(c => ({ ...c, username: e.target.value }))}
                            className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-[var(--muted)] mb-1">Password (Optional)</label>
                          <input
                            type="password"
                            autoComplete="off"
                            placeholder="••••"
                            value={proxyConfig.password}
                            onChange={(e) => setProxyConfig(c => ({ ...c, password: e.target.value }))}
                            className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {activeView === "runs" ? (
          <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto w-full px-6 py-10 space-y-8 pb-20">
              <h2 className="text-2xl font-semibold">Latest Run</h2>
              
              {lastRun ? (
                <div className="space-y-8">
                  <div className="flex gap-8 text-[15px] bg-[var(--surface-subtle)] border border-[var(--border)] p-5 rounded-2xl">
                    <div className="flex flex-col"><span className="text-[var(--muted)] text-xs uppercase tracking-wider mb-1">Mode</span><span className="font-medium">{lastRun.mode.toUpperCase()}</span></div>
                    <div className="flex flex-col"><span className="text-[var(--muted)] text-xs uppercase tracking-wider mb-1">Opinions</span><span className="font-medium">{lastRun.opinions.length}</span></div>
                    <div className="flex flex-col"><span className="text-[var(--muted)] text-xs uppercase tracking-wider mb-1">Failures</span><span className="font-medium">{lastRun.failures.length}</span></div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)] pb-2">Opinions</h3>
                    {lastRun.opinions.length === 0 && <div className="text-[15px] text-[var(--muted)] py-2">No opinions collected.</div>}
                    {lastRun.opinions.map((opinion) => (
                      <div key={`${serializeModelSelection(opinion)}:${opinion.content.slice(0, 16)}`} className="bg-[var(--surface-subtle)] border border-[var(--border)] rounded-2xl p-5">
                        <div className="text-xs font-semibold text-[var(--foreground)] mb-3 bg-[var(--background)] w-fit px-3 py-1 rounded-md border border-[var(--border)]">{opinion.label}</div>
                        <div className="text-[15px] leading-relaxed markdown-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {opinion.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    ))}
                  </div>

                  {lastRun.failures.length > 0 && (
                    <div className="space-y-4 pt-4">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-red-500/70 border-b border-red-500/20 pb-2">Failures</h3>
                      {lastRun.failures.map((failure) => (
                        <div key={`${serializeModelSelection(failure)}:${failure.error}`} className="bg-red-500/5 border border-red-500/10 rounded-2xl p-5">
                          <div className="text-xs font-semibold text-red-500 mb-3 bg-red-500/10 w-fit px-3 py-1 rounded-md border border-red-500/20">{failure.label}</div>
                          <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-[var(--foreground)]/80">{failure.error}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[15px] text-[var(--muted)] p-8 bg-[var(--surface-subtle)] border border-[var(--border)] rounded-2xl text-center">
                  No runs yet. Send a prompt in the chat to see routing results here.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
