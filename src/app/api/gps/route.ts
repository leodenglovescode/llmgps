import { NextRequest, NextResponse } from "next/server";

import { GpsError, runGpsWorkflowStreaming, type ClientGpsRequestPayload } from "@/lib/gps";
import { logError } from "@/lib/logger";
import { getAuthenticatedUsername } from "@/lib/server-auth";
import { getExecutionSettings } from "@/lib/server-state";

export async function POST(request: NextRequest) {
  try {
    const username = await getAuthenticatedUsername(request);

    if (!username) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const payload = (await request.json()) as ClientGpsRequestPayload;
    const executionSettings = await getExecutionSettings();
    const executionPayload = {
      ...payload,
      apiKeys: executionSettings.apiKeys,
      ollamaBaseUrl: executionSettings.ollamaBaseUrl,
      proxyUrl: executionSettings.proxyUrl,
      webSearchConfig: executionSettings.webSearchConfig
        ? { ...executionSettings.webSearchConfig, enabled: payload.webSearchEnabled ?? executionSettings.webSearchConfig.enabled }
        : undefined,
    };

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of runGpsWorkflowStreaming(executionPayload)) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(chunk) + '\n'));
          }
          controller.close();
        } catch (error: unknown) {
          logError("gps/stream", "Streaming workflow error", error);
          const errorMessage = error instanceof GpsError 
            ? error.message 
            : error instanceof Error ? error.message : "Something went wrong.";
            
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify({ type: 'error', error: errorMessage }) + '\n')
          );
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    logError("gps", "Request handling error", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Something went wrong.",
      },
      { status: 500 },
    );
  }
}
