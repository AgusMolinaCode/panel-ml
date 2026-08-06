import { syncUserVisits } from "../lib/ml/visits";
import { logSyncFinish, logSyncStart } from "../lib/db";
import { NotAuthenticatedError } from "../lib/ml/auth";
import { MercadoLibreApiError } from "../lib/ml/client";

/**
 * Worker job: fetch the seller's last 30 days of visits.
 * The API caps the window at 150 days; we use 30 to keep responses small.
 */
export async function runSyncVisits(days = 30): Promise<void> {
  const logId = await logSyncStart("worker.sync-visits");
  try {
    const count = await syncUserVisits(days);
    await logSyncFinish(logId, "success", count);
    console.log(`[sync-visits] stored ${count} daily records`);
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      await logSyncFinish(logId, "error", 0, "Not authenticated");
      console.log("[sync-visits] skipped — not authenticated yet");
      return;
    }
    const message =
      err instanceof MercadoLibreApiError
        ? `${err.message} — ${JSON.stringify(err.body)}`
        : err instanceof Error
        ? err.message
        : "Unknown error";
    await logSyncFinish(logId, "error", 0, message);
    console.error(`[sync-visits] failed: ${message}`);
  }
}