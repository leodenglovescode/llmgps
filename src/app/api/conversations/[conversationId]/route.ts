import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedUsername } from "@/lib/server-auth";
import { deleteConversationHistory, getConversationHistory } from "@/lib/server-state";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const username = await getAuthenticatedUsername(request);

  if (!username) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { conversationId } = await context.params;
  const conversation = await getConversationHistory(conversationId);

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  return NextResponse.json({ conversation });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const username = await getAuthenticatedUsername(request);

  if (!username) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { conversationId } = await context.params;
  await deleteConversationHistory(conversationId);
  return NextResponse.json({ ok: true });
}