import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedUsername } from "@/lib/server-auth";
import { logError } from "@/lib/logger";
import { getAppStatus } from "@/lib/server-state";

type OllamaTagsResponse = {
  models: { name: string }[];
};

export async function GET(request: NextRequest) {
  const username = await getAuthenticatedUsername(request);

  if (!username) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const status = await getAppStatus(username);

  if (!status.ollamaConfig.enabled) {
    return NextResponse.json({ error: "Ollama is not enabled." }, { status: 400 });
  }

  const baseUrl = status.ollamaConfig.baseUrl?.trim().replace(/\/$/, "") || "http://127.0.0.1:11434";
  const tagsUrl = `${baseUrl}/api/tags`;

  try {
    const response = await fetch(tagsUrl, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Ollama responded with HTTP ${response.status}` },
        { status: 502 },
      );
    }

    const data = (await response.json()) as OllamaTagsResponse;
    const models = (data.models ?? []).map((m) => m.name).filter(Boolean);

    return NextResponse.json({ models });
  } catch (error) {
    logError("ollama/tags", "Ollama tags fetch error", error);
    const message = error instanceof Error ? error.message : "Could not reach Ollama.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
