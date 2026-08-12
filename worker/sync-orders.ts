import { syncRecentOrders } from "../lib/ml/orders";
import { runSyncClaims } from "./sync-claims";
import { logSyncFinish, logSyncStart } from "../lib/db";
import { NotAuthenticatedError } from "../lib/ml/auth";

/**
 * Sync recent orders from MercadoLibre into SQLite.
 */
export async function runSyncOrders(days = 30): Promise<void> {
  const logId = await logSyncStart("worker.sync-orders");
  try {
    const processed = await syncRecentOrders(days, 50, false);
    await logSyncFinish(logId, "success", processed);
    console.log(`[sync-orders] processed ${processed} orders`);

    // Refresh claims after orders so open/closed claim badges stay up to date.
    await runSyncClaims();
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      await logSyncFinish(logId, "error", 0, "Not authenticated");
      console.log("[sync-orders] skipped — not authenticated yet");
      return;
    }
    const message = err instanceof Error ? err.message : "Unknown sync error";
    await logSyncFinish(logId, "error", 0, message);
    console.error(`[sync-orders] failed: ${message}`);
  }
}