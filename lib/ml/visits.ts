import { getCredentials, upsertUserVisits } from "../db";
import { mlGet } from "./client";
import { NotAuthenticatedError } from "./auth";

/**
 * MercadoLibre Visits API.
 * https://developers.mercadolibre.com.ar/es_ar/recurso-de-visitas
 *
 * Key endpoints:
 * - GET /users/{user_id}/items_visits/time_window?last=N&unit=day&ending=YYYY-MM-DD
 *   → total visits aggregated for the seller, per day
 * - GET /items/{item_id}/visits/time_window?last=N&unit=day
 *   → per-item daily visits
 *
 * Max window: 150 days. The response includes results[].date (ISO) and
 * results[].total (int). We store the user-level aggregate under the
 * pseudo-item_id "__user__" so it can be queried in the same table.
 */

interface MlTimeWindowResponse {
  user_id?: number;
  item_id?: string;
  total_visits?: number;
  date_from?: string;
  date_to?: string;
  last?: number;
  unit?: string;
  results?: Array<{
    date: string;
    total: number;
    visits_detail?: Array<{ company: string; quantity: number }>;
  }>;
}

function isoToDate(iso: string): string {
  // Convert ISO datetime to YYYY-MM-DD in ART (UTC-3).
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso.slice(0, 10);
  const art = new Date(ms - 180 * 60_000);
  return art.toISOString().slice(0, 10);
}

/**
 * Sync user-level visits for the last `days` days (max 150).
 * Returns the number of daily records stored.
 */
export async function syncUserVisits(days = 30): Promise<number> {
  if (days < 1) days = 1;
  if (days > 150) days = 150;

  const creds = await getCredentials();
  if (!creds) throw new NotAuthenticatedError();

  const res = await mlGet<MlTimeWindowResponse>(
    `/users/${creds.user_id}/items_visits/time_window`,
    { last: days, unit: "day" }
  );

  const results = res.results ?? [];
  const rows = results.map((r) => ({
    date: isoToDate(r.date),
    total: r.total,
  }));
  return await upsertUserVisits(rows);
}

/**
 * Sync visits for a specific item (last `days` days).
 */
export async function syncItemVisits(itemId: string, days = 30): Promise<number> {
  if (days < 1) days = 1;
  if (days > 150) days = 150;

  const res = await mlGet<MlTimeWindowResponse>(`/items/${itemId}/visits/time_window`, {
    last: days,
    unit: "day",
  });

  const results = res.results ?? [];
  const rows = results.map((r) => ({ date: isoToDate(r.date), total: r.total }));
  return await upsertUserVisits(rows); // Reuses the same upsert; the caller passes itemId via key if needed
}