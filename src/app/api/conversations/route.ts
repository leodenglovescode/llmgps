import { NextRequest, NextResponse } from "next/server";

import {
  sanitizeConversationMessages,
  sanitizeGpsResponsePayload,
  type ConversationMessage,
} from "@/lib/chat-history";
import { getAuthenticatedUsername } from "@/lib/server-auth";
import { logError } from "@/lib/logger";
import { listConversationHistory, saveConversationHistory } from "@/lib/server-state";

type SaveConversationPayload = {
  conversationId?: string | null;
  lastRun?: unknown;
  messages?: unknown;
};

export async function GET(request: NextRequest) {
  const username = await getAuthenticatedUsername(request);

  if (!username) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const conversations = await listConversationHistory();
  return NextResponse.json({ conversations });
}

export async function POST(request: NextRequest) {
  const username = await getAuthenticatedUsername(request);

  if (!username) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as SaveConversationPayload;
    const messages = sanitizeConversationMessages(payload.messages) as ConversationMessage[];

    if (messages.length === 0) {
      return NextResponse.json({ error: "Cannot save an empty conversation." }, { status: 400 });
    }

    const conversation = await saveConversationHistory({
      conversationId: payload.conversationId,
      lastRun: sanitizeGpsResponsePayload(payload.lastRun),
      messages,
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    logError("conversations", "Save conversation error", error);
    const message = error instanceof Error ? error.message : "Unable to save the conversation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}