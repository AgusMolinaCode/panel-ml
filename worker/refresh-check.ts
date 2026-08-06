import { logSyncFinish, logSyncStart } from "../lib/db";
import { refreshAccessToken } from "../lib/ml/auth";
import { getCredentials } from "../lib/db";

const REFRESH_BUFFER_MS = 15 * 60 * 1000;

/**
 * Refresh the access token if it's expired or about to expire.
 * Logs the result to sync_log.
 */
export async function runRefreshCheck(): Promise<void> {
  const logId = await logSyncStart("worker.refresh-check");
  const creds = await getCredentials();
  if (!creds) {
    await logSyncFinish(logId, "error", 0, "No credentials stored");
    return;
  }

  try {
    if (creds.expires_at - Date.now() <= REFRESH_BUFFER_MS) {
      await refreshAccessToken(creds.refresh_token);
      await logSyncFinish(logId, "success", 1, null);
      console.log(
        `[refresh-check] token refreshed; new expires_at: ${new Date(creds.expires_at).toISOString()}`
      );
    } else {
      const minutesLeft = Math.floor((creds.expires_at - Date.now()) / 60000);
      await logSyncFinish(logId, "success", 0, null);
      console.log(`[refresh-check] token valid for ${minutesLeft} more minutes — skipping refresh`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown refresh error";
    await logSyncFinish(logId, "error", 0, message);
    console.error(`[refresh-check] failed: ${message}`);
  }
}