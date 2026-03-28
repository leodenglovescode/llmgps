import { NextRequest, NextResponse } from "next/server";

import {
  sanitizeCustomEndpointConfig,
  sanitizeLanguage,
  sanitizeOllamaConfig,
  sanitizeProxyConfig,
  sanitizeRoutingPreferences,
  sanitizeThinkingConfig,
  sanitizeUserMemoriesConfig,
  sanitizeWebSearchConfig,
  type CustomEndpointConfig,
  type Language,
  type OllamaConfig,
  type ProxyConfig,
  type RoutingPreferencesPayload,
  type ThinkingConfig,
  type UserMemoriesConfig,
  type WebSearchConfig,
} from "@/lib/app-config";
import { getAuthenticatedUsername } from "@/lib/server-auth";
import { logError } from "@/lib/logger";
import { getAppStatus, saveOwnerSettings } from "@/lib/server-state";
import type { ProviderId } from "@/lib/llm";

type SettingsPayload = {
  apiKeys?: Partial<Record<ProviderId, string | null>>;
  customEndpointConfig?: Partial<CustomEndpointConfig>;
  language?: Language;
  ollamaConfig?: Partial<OllamaConfig>;
  proxyConfig?: Partial<ProxyConfig>;
  routingPreferences?: Partial<RoutingPreferencesPayload>;
  thinkingConfig?: Partial<ThinkingConfig>;
  userMemories?: Partial<UserMemoriesConfig>;
  webSearchConfig?: Partial<WebSearchConfig>;
};

export async function GET(request: NextRequest) {
  const username = await getAuthenticatedUsername(request);

  if (!username) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const status = await getAppStatus(username);
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  const username = await getAuthenticatedUsername(request);

  if (!username) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as SettingsPayload;
    await saveOwnerSettings({
      apiKeys: payload.apiKeys,
      customEndpointConfig: payload.customEndpointConfig ? sanitizeCustomEndpointConfig(payload.customEndpointConfig) : undefined,
      language: payload.language !== undefined ? sanitizeLanguage(payload.language) : undefined,
      ollamaConfig: payload.ollamaConfig ? sanitizeOllamaConfig(payload.ollamaConfig) : undefined,
      proxyConfig: payload.proxyConfig ? sanitizeProxyConfig(payload.proxyConfig) : undefined,
      routingPreferences: payload.routingPreferences
        ? sanitizeRoutingPreferences(payload.routingPreferences)
        : undefined,
      thinkingConfig: payload.thinkingConfig
        ? sanitizeThinkingConfig(payload.thinkingConfig)
        : undefined,
      userMemories: payload.userMemories
        ? sanitizeUserMemoriesConfig(payload.userMemories)
        : undefined,
      webSearchConfig: payload.webSearchConfig
        ? sanitizeWebSearchConfig(payload.webSearchConfig)
        : undefined,
    });
    const status = await getAppStatus(username);
    return NextResponse.json(status);
  } catch (error) {
    logError("settings", "Save settings error", error);
    const message = error instanceof Error ? error.message : "Unable to save settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
