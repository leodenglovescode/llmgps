import "server-only";

import type { NextRequest } from "next/server";

import { getSessionSecret } from "@/lib/server-state";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/session";

export async function getAuthenticatedUsername(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const sessionSecret = await getSessionSecret();
  const session = verifySessionToken(token, sessionSecret);
  return session?.username ?? null;
}
