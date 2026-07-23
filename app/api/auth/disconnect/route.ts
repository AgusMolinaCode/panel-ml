import { NextResponse } from "next/server";
import { getCredentials, clearCredentials } from "@/lib/db";

/**
 * POST /api/auth/disconnect
 * Clears stored credentials from the local SQLite. Next requests will require
 * the user to re-authenticate via the OAuth flow.
 */
export async function POST(): Promise<NextResponse> {
  const creds = getCredentials();
  if (!creds) {
    return NextResponse.json({ success: true, message: "Already disconnected" });
  }
  clearCredentials();
  return NextResponse.json({ success: true });
}