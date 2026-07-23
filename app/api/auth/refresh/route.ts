import { NextResponse } from "next/server";
import { getCredentials } from "@/lib/db";
import { refreshAccessToken, TokenExchangeError } from "@/lib/ml/auth";

/**
 * POST /api/auth/refresh
 * Forces a refresh of the access token using the stored refresh_token.
 * Useful for manual testing. The worker also does this proactively.
 */
export async function POST(): Promise<NextResponse> {
  const creds = getCredentials();
  if (!creds) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const refreshed = await refreshAccessToken(creds.refresh_token);
    return NextResponse.json({
      success: true,
      expires_in: refreshed.expires_in,
      user_id: refreshed.user_id,
    });
  } catch (err) {
    if (err instanceof TokenExchangeError) {
      return NextResponse.json({ error: err.message }, { status: err.status ?? 400 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}