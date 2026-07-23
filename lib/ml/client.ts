import { config } from "../config";
import { NotAuthenticatedError, getValidAccessToken } from "./auth";

/**
 * Thin HTTP client for the MercadoLibre REST API.
 * - Injects Authorization header with a valid (auto-refreshed) access token
 * - Parses JSON responses
 * - Surfaces typed errors on non-2xx
 */

export class MercadoLibreApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "MercadoLibreApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  // Path may already start with / or be a full URL after config.ml.apiBase
  const base = config.ml.apiBase.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  let url = `${base}${cleanPath}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

export async function mlRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const doRequest = async (token: string): Promise<T> => {
    const url = buildUrl(path, options.query);

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    };

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      if (typeof options.body === "string") {
        body = options.body;
      } else {
        body = JSON.stringify(options.body);
        headers["Content-Type"] = "application/json";
      }
    }

    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body,
    });

    if (res.status === 401) {
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep as text
      }
      throw new MercadoLibreApiError(
        `ML API ${options.method ?? "GET"} ${path} failed: ${res.status} ${res.statusText}`,
        res.status,
        parsed
      );
    }

    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep as text
      }
      throw new MercadoLibreApiError(
        `ML API ${options.method ?? "GET"} ${path} failed: ${res.status} ${res.statusText}`,
        res.status,
        parsed
      );
    }

    if (res.status === 204) return undefined as T;

    return (await res.json()) as T;
  };

  try {
    const token = await getValidAccessToken();
    return await doRequest(token);
  } catch (err) {
    if (err instanceof MercadoLibreApiError && err.status === 401) {
      const newToken = await getValidAccessToken();
      return await doRequest(newToken);
    }
    throw err;
  }
}

/**
 * Higher-level wrapper. Throws NotAuthenticatedError on 401.
 */
export async function mlGet<T>(path: string, query?: RequestOptions["query"]): Promise<T> {
  try {
    return await mlRequest<T>(path, { method: "GET", query });
  } catch (err) {
    if (err instanceof MercadoLibreApiError && err.status === 401) {
      throw new NotAuthenticatedError();
    }
    throw err;
  }
}