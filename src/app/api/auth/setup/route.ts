import { NextResponse } from "next/server";

import { logError } from "@/lib/logger";
import { initializeOwner } from "@/lib/server-state";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { password?: string; username?: string };
    const username = payload.username?.trim() ?? "";
    const password = payload.password?.trim() ?? "";

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required." },
        { status: 400 },
      );
    }

    await initializeOwner(username, password);

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("auth/setup", "Setup error", error);
    const message = error instanceof Error ? error.message : "Unable to complete setup.";
    const status = message.includes("already") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
