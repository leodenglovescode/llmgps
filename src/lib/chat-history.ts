import type { GpsResponsePayload } from "@/lib/gps";
import type { ChatMessage, ModelSelection } from "@/lib/llm";

export type ConversationPhase = "initial" | "debate";

export type ConversationMessage = ChatMessage & {
  id: string;
  isOpinion?: boolean;
  modelLabel?: string;
  phase?: ConversationPhase;
  thinking?: string;
};

export type CompressionRound = {
  roundNumber: number;
  originalTokenEstimate: number;
  compressedTokenEstimate: number;
  timestamp: string;
};

export type ConversationRecord = {
  id: string;
  title: string;
  preview: string;
  messages: ConversationMessage[];
  lastRun: GpsResponsePayload | null;
  compressedContext: string | null;
  compressionHistory: CompressionRound[];
  createdAt: string;
  updatedAt: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

function sanitizeModelSelection(input: unknown): ModelSelection | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<ModelSelection>;

  if (
    candidate.providerId !== "openai" &&
    candidate.providerId !== "anthropic" &&
    candidate.providerId !== "gemini" &&
    candidate.providerId !== "openrouter" &&
    candidate.providerId !== "deepseek" &&
    candidate.providerId !== "xai" &&
    candidate.providerId !== "ollama"
  ) {
    return null;
  }

  const modelId = typeof candidate.modelId === "string" ? candidate.modelId.trim() : "";
  const label = typeof candidate.label === "string" ? candidate.label.trim() : "";

  if (!modelId) {
    return null;
  }

  return {
    providerId: candidate.providerId,
    modelId,
    label: label || modelId,
  };
}

function sanitizeRunEntries(input: unknown, kind: "content" | "error") {
  if (!Array.isArray(input)) {
    return [];
  }

  const next: Array<(ModelSelection & { content: string }) | (ModelSelection & { error: string })> = [];

  for (const item of input) {
    const model = sanitizeModelSelection(item);
    if (!model) {
      continue;
    }

    const rawValue =
      kind === "content"
        ? (item as { content?: unknown }).content
        : (item as { error?: unknown }).error;
    const value = typeof rawValue === "string" ? rawValue.trim() : "";

    if (!value) {
      continue;
    }

    next.push(kind === "content" ? { ...model, content: value } : { ...model, error: value });
  }

  return next;
}

export function sanitizeConversationMessage(input: unknown): ConversationMessage | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<ConversationMessage>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
  const modelLabel = typeof candidate.modelLabel === "string" ? candidate.modelLabel.trim() : undefined;

  if (!id || !content || (candidate.role !== "user" && candidate.role !== "assistant")) {
    return null;
  }

  return {
    id,
    role: candidate.role,
    content,
    isOpinion: Boolean(candidate.isOpinion),
    modelLabel: modelLabel || undefined,
    phase: candidate.phase === "initial" || candidate.phase === "debate" ? candidate.phase : undefined,
    thinking: typeof candidate.thinking === "string" && candidate.thinking ? candidate.thinking : undefined,
  };
}

export function sanitizeConversationMessages(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  const next: ConversationMessage[] = [];

  for (const item of input) {
    const message = sanitizeConversationMessage(item);
    if (message) {
      next.push(message);
    }
  }

  return next;
}

export function sanitizeGpsResponsePayload(input: unknown): GpsResponsePayload | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<GpsResponsePayload>;
  const consensus = typeof candidate.consensus === "string" ? candidate.consensus.trim() : "";

  if (!consensus || (candidate.mode !== "gps" && candidate.mode !== "single")) {
    return null;
  }

  return {
    consensus,
    failures: sanitizeRunEntries(candidate.failures, "error") as GpsResponsePayload["failures"],
    mode: candidate.mode,
    opinions: sanitizeRunEntries(candidate.opinions, "content") as GpsResponsePayload["opinions"],
    responderCount:
      typeof candidate.responderCount === "number" && Number.isFinite(candidate.responderCount)
        ? Math.max(0, Math.floor(candidate.responderCount))
        : 0,
  };
}

export function buildConversationSummary(conversation: ConversationRecord): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    preview: conversation.preview,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.filter((message) => !message.isOpinion).length,
  };
}