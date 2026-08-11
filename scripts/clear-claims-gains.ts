/**
 * Clear gains for all orders that have an open or closed claim.
 * Run this once to fix existing data, then the worker will keep it clean.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/clear-claims-gains.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Find all orders with claims that still have a stored gain
  const { data, error } = await supabase
    .from("order_costs")
    .select("order_id, gain, order_costs(order_id)")
    .not("gain", "is", null)
    .not("order_id", "in", "(select id from orders where claim_status is null)");

  if (error) {
    console.error("Error querying:", error);
    process.exit(1);
  }

  console.log(`Found ${data?.length ?? 0} orders with gains that also have claims`);

  // Get orders with claim_status that also have a gain
  const { data: claimOrders } = await supabase
    .from("orders")
    .select("id")
    .not("claim_status", "is", null);

  if (!claimOrders || claimOrders.length === 0) {
    console.log("No orders with claims found.");
    return;
  }

  const claimOrderIds = claimOrders.map((o) => o.id);
  console.log(`Orders with claims: ${claimOrderIds.length}`);

  // Clear gains for those orders
  const { data: updated, error: updateError } = await supabase
    .from("order_costs")
    .update({ gain: null, updated_at: Date.now() })
    .in("order_id", claimOrderIds)
    .not("gain", "is", null)
    .select("order_id");

  if (updateError) {
    console.error("Error updating:", updateError);
    process.exit(1);
  }

  console.log(`Cleared gains for ${updated?.length ?? 0} orders with claims:`);
  for (const row of updated ?? []) {
    console.log(`  - Order ${row.order_id}`);
  }
}

main();
