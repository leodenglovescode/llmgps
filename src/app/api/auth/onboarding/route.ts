import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedUsername } from "@/lib/server-auth";
import { completeApiKeyPrompt, getAppStatus } from "@/lib/server-state";

export async function POST(request: NextRequest) {
  const username = await getAuthenticatedUsername(request);

  if (!username) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    await completeApiKeyPrompt();
    const status = await getAppStatus(username);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update onboarding.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
