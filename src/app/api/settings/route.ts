import { NextRequest, NextResponse } from "next/server";

import {
  sanitizeOllamaConfig,
  sanitizeProxyConfig,
  sanitizeRoutingPreferences,
  type OllamaConfig,
  type ProxyConfig,
  type RoutingPreferencesPayload,
} from "@/lib/app-config";
import { getAuthenticatedUsername } from "@/lib/server-auth";
import { getAppStatus, saveOwnerSettings } from "@/lib/server-state";
import type { ProviderId } from "@/lib/llm";

type SettingsPayload = {
  apiKeys?: Partial<Record<ProviderId, string | null>>;
  ollamaConfig?: Partial<OllamaConfig>;
  proxyConfig?: Partial<ProxyConfig>;
  routingPreferences?: Partial<RoutingPreferencesPayload>;
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
      ollamaConfig: payload.ollamaConfig ? sanitizeOllamaConfig(payload.ollamaConfig) : undefined,
      proxyConfig: payload.proxyConfig ? sanitizeProxyConfig(payload.proxyConfig) : undefined,
      routingPreferences: payload.routingPreferences
        ? sanitizeRoutingPreferences(payload.routingPreferences)
        : undefined,
    });
    const status = await getAppStatus(username);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
