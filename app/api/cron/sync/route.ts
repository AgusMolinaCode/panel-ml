import { NextResponse } from "next/server";
import { runSyncOrders } from "@/lib/ml/orders";
import { runSyncClaims } from "@/worker/sync-claims";
import { runRefreshCheck } from "@/worker/refresh-check";
import { logSyncFinish, logSyncStart, clearGainsForOrdersWithClaims } from "@/lib/db";
import { broadcast } from "@/lib/sse/emitter";

/**
 * GET /api/cron/sync
 *
 * Vercel Cron Job — runs every 10 minutes.
 * Handles: token refresh, orders sync, claims sync.
 *
 * Configure in vercel.json:
 * {
 *   "crons": [{ "path": "/api/cron/sync", "schedule": "*/10 * * * *" }]
 * }
 *
 * To secure, add VERCEL_CRON_SECRET env var and check it:
 *   if (req.headers.get("x-cron-secret") !== process.env.VERCEL_CRON_SECRET) ...
 */
export async function GET(): Promise<NextResponse> {
  const results: string[] = [];
  const errors: string[] = [];

  // Refresh token
  try {
    await runRefreshCheck();
    results.push("refresh-check: ok");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`refresh-check: ${msg}`);
  }

  // Sync orders (last 90 days)
  let ordersLogId: number | null = null;
  try {
    ordersLogId = await logSyncStart("cron.sync-orders");
    const processed = await runSyncOrders(90);
    await logSyncFinish(ordersLogId, "success", processed);
    results.push(`sync-orders: ${processed} orders`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (ordersLogId !== null) await logSyncFinish(ordersLogId, "error", 0, msg).catch(() => {});
    errors.push(`sync-orders: ${msg}`);
  }

  // Sync claims
  let claimsLogId: number | null = null;
  try {
    claimsLogId = await logSyncStart("cron.sync-claims");
    await runSyncClaims();
    await logSyncFinish(claimsLogId, "success", 0);
    results.push("sync-claims: ok");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (claimsLogId !== null) await logSyncFinish(claimsLogId, "error", 0, msg).catch(() => {});
    errors.push(`sync-claims: ${msg}`);
  }

  // Clear gains for orders that have open/closed claims
  try {
    const cleared = await clearGainsForOrdersWithClaims();
    if (cleared > 0) results.push(`clear-claims-gains: ${cleared} cleared`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`clear-claims-gains: ${msg}`);
  }

  // Broadcast so all connected frontends refresh
  broadcast("order:updated", { source: "cron-sync" });

  if (errors.length > 0) {
    console.error("[cron/sync] errors:", errors);
    return NextResponse.json(
      { ok: false, results, errors },
      { status: 500 }
    );
  }

  console.log("[cron/sync]", results.join(" | "));
  return NextResponse.json({ ok: true, results });
}
