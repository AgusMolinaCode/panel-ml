import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, fetchAndStoreUserInfo, TokenExchangeError } from "@/lib/ml/auth";

/**
 * POST /api/auth/manual-code
 * Body: { code: string }
 *
 * The MercadoLibre OAuth flow's REDIRECT_URI points to the user's production
 * domain (https://www.am-motos-repuestos.com.ar/api/auth/callback). The user
 * pastes the `code` they received into this local endpoint so we can exchange
 * it for tokens here and store them in our local SQLite.
 *
 * After this one-time handshake, the entire panel runs locally.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = (body as { code?: string }).code?.trim();
  if (!raw) {
    return NextResponse.json({ error: "Missing 'code' in body" }, { status: 400 });
  }

  // Accept either a bare code (TG-...) or a full redirect URL with ?code=...
  let code = raw;
  if (raw.includes("code=") || raw.startsWith("http")) {
    try {
      const url = new URL(raw.includes("http") ? raw : `https://dummy/?${raw}`);
      const extracted = url.searchParams.get("code");
      if (!extracted) {
        return NextResponse.json(
          { error: "No 'code' query param found in the URL" },
          { status: 400 }
        );
      }
      code = extracted;
    } catch {
      return NextResponse.json(
        { error: "Invalid URL or code format" },
        { status: 400 }
      );
    }
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    // Best-effort: enrich with nickname/email
    try {
      await fetchAndStoreUserInfo();
    } catch {
      // non-fatal
    }

    return NextResponse.json({
      success: true,
      user_id: tokens.user_id,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
    });
  } catch (err) {
    if (err instanceof TokenExchangeError) {
      return NextResponse.json(
        { error: err.message, status: err.status },
        { status: err.status ?? 400 }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error during token exchange";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}