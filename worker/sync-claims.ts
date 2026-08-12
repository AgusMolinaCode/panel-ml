/**
 * Sync claim statuses for recent orders from MercadoLibre.
 * Updates claim_status to:
 *   - 'opened' if at least one claim is open
 *   - 'closed' if there are only closed claims
 *   - null   if no claims exist (clears stale claim statuses)
 *
 * Strategy (keeps Vercel/serverless runtimes within ~10-15s):
 *   1. Always re-check orders that currently have a claim (opened/closed)
 *      so we detect when a claim is closed/resolved.
 *   2. Check up to 75 recent orders without a claim to catch newly opened claims.
 *   3. Process in small parallel batches with a short delay between batches
 *      to respect ML rate limits without being too slow.
 */

import { getSupabase } from "../lib/supabase";
import { getOrderClaimStatus } from "../lib/ml/claims";
import { updateOrderClaimStatus, clearOrderGain } from "../lib/db";

const LOOKBACK_DAYS = 90;
const RECENT_ORDERS_LIMIT = 75;
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 100;

export async function runSyncClaims(): Promise<{ checked: number; withClaims: number }> {
  const supabase = getSupabase();
  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  const [{ data: activeClaims }, { data: recentOrders }] = await Promise.all([
    // Orders that currently have a claim — must be re-checked to detect closure.
    supabase.from("orders").select("id").not("claim_status", "is", null),
    // Recent orders without a claim — catch newly opened claims.
    supabase
      .from("orders")
      .select("id")
      .gte("date_created", cutoff)
      .is("claim_status", null)
      .order("date_created", { ascending: false })
      .limit(RECENT_ORDERS_LIMIT),
  ]);

  const orderIds = new Set<number>();
  for (const o of (activeClaims as Array<{ id: number }>) || []) orderIds.add(o.id);
  for (const o of (recentOrders as Array<{ id: number }>) || []) orderIds.add(o.id);

  const ids = Array.from(orderIds);
  let withClaims = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        const claimStatus = await getOrderClaimStatus(id);
        await updateOrderClaimStatus(id, claimStatus);
        if (claimStatus !== null) {
          // Claim found: clear any stored gain since the order is disputed
          await clearOrderGain(id);
        }
        return claimStatus;
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value !== null) {
        withClaims++;
      }
    }

    if (i + BATCH_SIZE < ids.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(`[sync-claims] checked ${ids.length} orders, found ${withClaims} with claims`);
  return { checked: ids.length, withClaims };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
