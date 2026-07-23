import { NextResponse } from "next/server";
import { getCredentials } from "@/lib/db";
import { isAuthenticated } from "@/lib/ml/auth";

/**
 * GET /api/auth/status
 * Returns current connection status, token expiry, and seller info.
 */
export async function GET(): Promise<NextResponse> {
  const creds = getCredentials();
  if (!creds || !isAuthenticated()) {
    return NextResponse.json({ connected: false });
  }

  const now = Date.now();
  const expiresInMs = creds.expires_at - now;
  const expiresInMin = Math.floor(expiresInMs / 60000);
  const isExpired = expiresInMs <= 0;
  const expiresSoon = expiresInMs < 15 * 60 * 1000;

  return NextResponse.json({
    connected: true,
    user_id: creds.user_id,
    nickname: creds.nickname,
    email: creds.email,
    expires_at: creds.expires_at,
    expires_in_minutes: expiresInMin,
    is_expired: isExpired,
    expires_soon: expiresSoon,
    scope: creds.scope,
  });
}