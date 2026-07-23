/**
 * Typed environment configuration.
 * Throws on boot if any required variable is missing.
 * Use this everywhere instead of touching `process.env` directly.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Check your .env.local file. See .env.example for the template.`
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

function intOptional(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value || value.trim() === "") return fallback;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${value}`);
  }
  return parsed;
}

export const config = {
  ml: {
    clientId: required("ML_CLIENT_ID"),
    clientSecret: required("ML_CLIENT_SECRET"),
    redirectUri: required("ML_REDIRECT_URI"),
    authUrl: optional("ML_AUTH_URL", "https://auth.mercadolibre.com.ar/authorization"),
    tokenUrl: optional("ML_TOKEN_URL", "https://api.mercadolibre.com/oauth/token"),
    apiBase: optional("ML_API_BASE", "https://api.mercadolibre.com"),
  },
  dollarBlue: {
    apiUrl: optional("DOLLAR_BLUE_API", "https://dolarapi.com/v1/dolares/blue"),
  },
  sync: {
    intervalMs: intOptional("SYNC_INTERVAL_MS", 5 * 60 * 1000),
  },
  paths: {
    db: optional("DB_PATH", "data/ml.db"),
  },
} as const;

export type AppConfig = typeof config;