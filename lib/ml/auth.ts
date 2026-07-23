import { config } from "../config";
import { getCredentials, saveCredentials } from "../db";

/**
 * MercadoLibre OAuth flow + automatic refresh.
 *
 * Flow:
 *  1. User opens authorization URL in browser
 *  2. User logs in, approves the app
 *  3. MercadoLibre redirects to ML_REDIRECT_URI with ?code=...
 *  4. We exchange that code for access_token + refresh_token (one-time)
 *  5. We store tokens in SQLite
 *  6. For every subsequent request, getValidAccessToken() returns a valid token,
 *     refreshing automatically if it's about to expire
 */

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  scope: string;
  user_id: number;
  refresh_token: string;
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated with MercadoLibre. Complete the OAuth flow first.");
    this.name = "NotAuthenticatedError";
  }
}

export class TokenExchangeError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "TokenExchangeError";
  }
}

/**
 * Build the URL the user opens in their browser to start the OAuth flow.
 * ML will redirect them to ML_REDIRECT_URI with ?code=... after approval.
 */
export function buildAuthorizationUrl(state?: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.ml.clientId,
    redirect_uri: config.ml.redirectUri,
  });
  if (state) params.set("state", state);
  return `${config.ml.authUrl}?${params.toString()}`;
}

/**
 * Exchange the authorization code (one-time) for access + refresh tokens.
 * Saves them to SQLite as the active credentials.
 */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.ml.clientId,
    client_secret: config.ml.clientSecret,
    code,
    redirect_uri: config.ml.redirectUri,
  });

  const res = await fetch(config.ml.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new TokenExchangeError(
      `Token exchange failed: ${res.status} ${res.statusText} — ${text}`,
      res.status
    );
  }

  const tokens = (await res.json()) as TokenResponse;
  persistTokens(tokens);
  return tokens;
}

/**
 * Refresh the access token using the stored refresh_token.
 * MercadoLibre rotates the refresh_token on every refresh — store the new one.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.ml.clientId,
    client_secret: config.ml.clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(config.ml.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new TokenExchangeError(
      `Token refresh failed: ${res.status} ${res.statusText} — ${text}`,
      res.status
    );
  }

  const tokens = (await res.json()) as TokenResponse;
  persistTokens(tokens);
  return tokens;
}

function persistTokens(tokens: TokenResponse): void {
  const expiresAt = Date.now() + tokens.expires_in * 1000;

  // Preserve nickname/email if we already have them; ML doesn't return them here.
  const existing = getCredentials();
  saveCredentials({
    user_id: tokens.user_id,
    nickname: existing?.user_id === tokens.user_id ? existing.nickname : null,
    email: existing?.user_id === tokens.user_id ? existing.email : null,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    scope: tokens.scope,
    token_type: tokens.token_type,
  });
}

/**
 * Best-effort user info lookup so we can show nickname in the UI.
 * Called after a successful exchange; failures are non-fatal.
 */
export async function fetchAndStoreUserInfo(): Promise<void> {
  const creds = getCredentials();
  if (!creds) throw new NotAuthenticatedError();

  const res = await fetch(`${config.ml.apiBase}/users/${creds.user_id}`, {
    headers: { Authorization: `Bearer ${creds.access_token}` },
  });
  if (!res.ok) return;

  const user = (await res.json()) as { id: number; nickname: string; email?: string };
  saveCredentials({
    user_id: user.id,
    nickname: user.nickname,
    email: user.email ?? null,
    access_token: creds.access_token,
    refresh_token: creds.refresh_token,
    expires_at: creds.expires_at,
    scope: creds.scope,
    token_type: creds.token_type,
  });
}

const REFRESH_BUFFER_MS = 15 * 60 * 1000; // refresh 15 min before expiry

/**
 * Returns a valid access_token, refreshing proactively if it's about to expire.
 * Throws NotAuthenticatedError if no credentials are stored.
 */
export async function getValidAccessToken(): Promise<string> {
  const creds = getCredentials();
  if (!creds) throw new NotAuthenticatedError();

  if (creds.expires_at - Date.now() > REFRESH_BUFFER_MS) {
    return creds.access_token;
  }

  const refreshed = await refreshAccessToken(creds.refresh_token);
  return refreshed.access_token;
}

export function isAuthenticated(): boolean {
  const creds = getCredentials();
  return creds !== null;
}