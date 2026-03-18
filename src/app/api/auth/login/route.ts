import { NextResponse } from "next/server";

import { logError } from "@/lib/logger";
import { getAppStatus, getSessionSecret, verifyOwnerLogin } from "@/lib/server-state";
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session";

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

    const isValid = await verifyOwnerLogin(username, password);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }

    const sessionSecret = await getSessionSecret();
    const token = createSessionToken(username, sessionSecret);
    const statusPayload = await getAppStatus(username);

    const response = NextResponse.json(statusPayload);
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions(request.url));
    return response;
  } catch (error) {
    logError("auth/login", "Login error", error);
    const message = error instanceof Error ? error.message : "Unable to log in.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
