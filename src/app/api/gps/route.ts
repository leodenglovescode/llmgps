import { NextResponse } from "next/server";
import { GpsError, runGpsWorkflowStreaming, type GpsRequestPayload } from "@/lib/gps";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as GpsRequestPayload;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of runGpsWorkflowStreaming(payload)) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(chunk) + '\n'));
          }
          controller.close();
        } catch (error: unknown) {
          console.error(error);
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
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Something went wrong.",
      },
      { status: 500 },
    );
  }
}
