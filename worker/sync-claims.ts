/**
 * Sync claim statuses for recent orders from MercadoLibre.
 * Checks orders from the last 90 days that may have open/closed claims.
 */

import { getDb } from "../lib/db";
import { getOrderClaimStatus } from "../lib/ml/claims";
import { updateOrderClaimStatus } from "../lib/db";

const LOOKBACK_DAYS = 90;

export async function runSyncClaims(): Promise<void> {
  const db = getDb();
  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  const orders = db
    .prepare(
      `SELECT id FROM orders WHERE date_created >= ? AND status NOT IN ('cancelled', 'invalid') ORDER BY date_created DESC LIMIT 200`
    )
    .all(cutoff) as Array<{ id: number }>;

  let updated = 0;

  for (const { id } of orders) {
    try {
      const claimStatus = await getOrderClaimStatus(id);
      if (claimStatus !== null) {
        updateOrderClaimStatus(id, claimStatus);
        updated++;
      }
    } catch (err) {
      console.error(`[sync-claims] failed for order ${id}:`, err);
    }

    await sleep(100);
  }

  console.log(`[sync-claims] checked ${orders.length} orders, updated ${updated} claim statuses`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
