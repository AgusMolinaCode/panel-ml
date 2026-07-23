import { syncShipmentsForPaidOrders } from "../lib/ml/shipments";
import { logSyncFinish, logSyncStart } from "../lib/db";
import { NotAuthenticatedError } from "../lib/ml/auth";
import { MercadoLibreApiError } from "../lib/ml/client";

/**
 * Worker job: fetch shipments for any paid order that doesn't have one yet.
 * Idempotent — re-running just skips orders that already have shipments.
 */
export async function runSyncShipments(limit = 50): Promise<void> {
  const logId = logSyncStart("worker.sync-shipments");
  try {
    const count = await syncShipmentsForPaidOrders(limit);
    logSyncFinish(logId, "success", count);
    console.log(`[sync-shipments] processed ${count} shipments`);
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      logSyncFinish(logId, "error", 0, "Not authenticated");
      console.log("[sync-shipments] skipped — not authenticated yet");
      return;
    }
    const message =
      err instanceof MercadoLibreApiError
        ? `${err.message} — ${JSON.stringify(err.body)}`
        : err instanceof Error
        ? err.message
        : "Unknown error";
    logSyncFinish(logId, "error", 0, message);
    console.error(`[sync-shipments] failed: ${message}`);
  }
}