import { NextRequest, NextResponse } from "next/server";

import { GpsError, runSynthesisOnly, type SynthesisRetryPayload } from "@/lib/gps";
import { logError } from "@/lib/logger";
import { getAuthenticatedUsername } from "@/lib/server-auth";
import { getExecutionSettings } from "@/lib/server-state";

export async function POST(request: NextRequest) {
  try {
    const username = await getAuthenticatedUsername(request);

    if (!username) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const payload = (await request.json()) as SynthesisRetryPayload;

    if (!payload.synthesizerModel) {
      return NextResponse.json({ error: "A synthesizer model is required." }, { status: 400 });
    }

    const executionSettings = await getExecutionSettings();
    const consensus = await runSynthesisOnly({
      ...payload,
      apiKeys: executionSettings.apiKeys,
      ollamaBaseUrl: executionSettings.ollamaBaseUrl,
      proxyUrl: executionSettings.proxyUrl,
    });

    return NextResponse.json({ consensus });
  } catch (error) {
    logError("gps/synthesize", "Synthesis retry failed", error);
    const message = error instanceof GpsError
      ? error.message
      : error instanceof Error ? error.message : "Synthesis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
