/**
 * Sync claim statuses for recent orders from MercadoLibre.
 * Checks orders from the last 90 days that may have open/closed claims.
 */

import { getSupabase } from "../lib/supabase";
import { getOrderClaimStatus } from "../lib/ml/claims";
import { updateOrderClaimStatus, clearOrderGain } from "../lib/db";

const LOOKBACK_DAYS = 90;

export async function runSyncClaims(): Promise<void> {
  const supabase = getSupabase();
  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  const { data } = await supabase
    .from("orders")
    .select("id")
    .gte("date_created", cutoff)
    .not("status", "in", '("cancelled","invalid")')
    .order("date_created", { ascending: false })
    .limit(200);

  const orders = (data as Array<{ id: number }>) || [];

  let updated = 0;

  for (const { id } of orders) {
    try {
      const claimStatus = await getOrderClaimStatus(id);
      if (claimStatus !== null) {
        await updateOrderClaimStatus(id, claimStatus);
        // Claim found: clear any stored gain since the order is disputed
        await clearOrderGain(id);
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
