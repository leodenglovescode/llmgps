import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedUsername } from "@/lib/server-auth";
import { getAppStatus } from "@/lib/server-state";

export async function GET(request: NextRequest) {
  const username = await getAuthenticatedUsername(request);
  const status = await getAppStatus(username);
  return NextResponse.json(status);
}
