/**
 * Recalcula ganancias de TODAS las órdenes en Supabase con la fórmula nueva:
 * - Comisión ML: 21% (sin separate cuotas 6%)
 * - Default fee: 21% en vez de 24.2%
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/recalculate-gains.ts
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Constants (nueva fórmula) ───────────────────────────────────────────────
const IVA_RATE = 0.21;
const DEFAULT_ML_FEE_PCT = 21;
const PERCEPCION_IVA_RATE = 0.01;
const PERCEPCION_COMISION_RATE = 0.03;
const IIBB_RATE = 0.0025;
const DERECHOS_IMPORT_RATE = 0.21;
const DEFAULT_ML_ENVIO = 7000;
const COURIER_USD_PER_KG = 18;
const DOLLAR_BLUE_DEFAULT = 1650;

function netOfIVA(totalAmount: number): number {
  return totalAmount / (1 + IVA_RATE);
}

function resolveMlFee(totalAmount: number, saleFee: number | null, mlFeePct: number | null): number {
  if (saleFee != null) return saleFee;
  const pct = mlFeePct ?? DEFAULT_ML_FEE_PCT;
  return totalAmount * (pct / 100);
}

function recalculateGain(
  totalAmount: number,
  saleFee: number | null,
  mlFeePct: number | null,
  costARS: number,
  mlEnvio: number | null,
  weightKg: number | null,
  dollarRate: number | null
): number {
  const dollar = dollarRate && dollarRate > 0 ? dollarRate : DOLLAR_BLUE_DEFAULT;
  const netSalePrice = netOfIVA(totalAmount);
  const mlFeeAmount = resolveMlFee(totalAmount, saleFee, mlFeePct);
  const percepcionIva = netSalePrice * PERCEPCION_IVA_RATE;
  const percepcionComision = mlFeeAmount * PERCEPCION_COMISION_RATE;
  const iibb = netSalePrice * IIBB_RATE;
  const derechosImport = costARS * DERECHOS_IMPORT_RATE;
  const envio = mlEnvio ?? DEFAULT_ML_ENVIO;
  const courierCostUSD = (weightKg ?? 0) * COURIER_USD_PER_KG;
  const courierCostARS = courierCostUSD * dollar;

  const gain =
    netSalePrice -
    mlFeeAmount -
    percepcionIva -
    percepcionComision -
    iibb -
    derechosImport -
    costARS -
    envio -
    courierCostARS;

  return gain;
}

async function main() {
  console.log("Fetching orders and costs separately...\n");

  // Fetch orders
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, total_amount, sale_fee")
    .in("status", ["paid", "confirmed", "partially_paid", "delivered"]);

  if (ordersError) {
    console.error("Error fetching orders:", ordersError);
    process.exit(1);
  }

  if (!orders || orders.length === 0) {
    console.log("No orders found.");
    return;
  }

  // Fetch all costs
  const orderIds = orders.map((o) => o.id);
  const { data: costs, error: costsError } = await supabase
    .from("order_costs")
    .select("order_id, cost, ml_fee_pct, ml_envio, weight_kg, gain, dollar_rate")
    .in("order_id", orderIds);

  if (costsError) {
    console.error("Error fetching costs:", costsError);
    process.exit(1);
  }

  // Build a map of order_id -> cost
  const costMap = new Map(
    (costs ?? []).map((c) => [c.order_id, c])
  );

  console.log(`Found ${orders.length} orders, ${costs?.length ?? 0} cost records.\n`);

  let updated = 0;
  let skipped = 0;

  for (const order of orders) {
    const cost = costMap.get(order.id);

    // Skip if no costs record
    if (!cost) {
      skipped++;
      continue;
    }

    // Only recalculate if gain was stored AND has a real cost (cost = 0 means no data entered)
    if (cost.gain == null || cost.cost == null || cost.cost === 0) {
      skipped++;
      continue;
    }

    const newGain = recalculateGain(
      order.total_amount,
      order.sale_fee,
      cost.ml_fee_pct,
      cost.cost,
      cost.ml_envio,
      cost.weight_kg,
      cost.dollar_rate
    );

    // Sanity check: skip if gain is unreasonably negative (< -1M) or total_amount is 0
    if (newGain < -1_000_000 || order.total_amount === 0) {
      console.log(`Order ${order.id}: SKIPPED (suspicious data: total=${order.total_amount}, cost=${cost.cost}, newGain=${newGain.toFixed(2)})`);
      skipped++;
      continue;
    }

    // Update in Supabase
    const { error: updateError } = await supabase
      .from("order_costs")
      .update({ gain: newGain })
      .eq("order_id", order.id);

    if (updateError) {
      console.error(`Failed to update order ${order.id}:`, updateError.message);
    } else {
      updated++;
      const diff = newGain - cost.gain;
      console.log(
        `Order ${order.id}: gain ${cost.gain.toFixed(2)} → ${newGain.toFixed(2)} (diff: ${diff >= 0 ? "+" : ""}${diff.toFixed(2)})`
      );
    }
  }

  console.log(`\n✅ Done: ${updated} updated, ${skipped} skipped`);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
