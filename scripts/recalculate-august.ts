/**
 * Calcula y guarda la ganancia de órdenes de AGOSTO 2026 con costo > 0.
 * Usa la fórmula nueva: Comisión ML 21% (sin cuotas separate).
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/recalculate-august.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

// Augusto 2026 starts at 1 Aug 2026 00:00 UTC
const AUG_2026_MS = new Date(2026, 7, 1).getTime();

function netOfIVA(totalAmount: number): number {
  return totalAmount / (1 + IVA_RATE);
}

function calculateGain(
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

  let mlFeeAmount: number;
  if (saleFee != null) {
    mlFeeAmount = saleFee;
  } else {
    const pct = mlFeePct ?? DEFAULT_ML_FEE_PCT;
    mlFeeAmount = totalAmount * (pct / 100);
  }

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
  console.log("Fetching orders from August 2026 with costs...\n");

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, total_amount, sale_fee, date_created")
    .gte("date_created", AUG_2026_MS)
    .in("status", ["paid", "confirmed", "partially_paid", "delivered"])
    .order("date_created", { ascending: true });

  if (error) {
    console.error("Error fetching orders:", error);
    process.exit(1);
  }

  if (!orders || orders.length === 0) {
    console.log("No orders from August 2026 found.");
    return;
  }

  console.log(`Found ${orders.length} orders from August 2026.`);

  const orderIds = orders.map((o) => o.id);

  const { data: costs, error: costsError } = await supabase
    .from("order_costs")
    .select("order_id, cost, ml_fee_pct, ml_envio, weight_kg, gain, dollar_rate")
    .in("order_id", orderIds);

  if (costsError) {
    console.error("Error fetching costs:", costsError);
    process.exit(1);
  }

  const costMap = new Map((costs ?? []).map((c) => [c.order_id, c]));

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const order of orders) {
    const cost = costMap.get(order.id);

    // Skip if no cost record or cost is null/0
    if (!cost || cost.cost == null || cost.cost === 0) {
      skipped++;
      continue;
    }

    // Skip if cost is suspiciously high (likely wrong data)
    if (cost.cost > 1_000_000) {
      console.log(`Order ${order.id}: SKIPPED (cost suspiciously high: ${cost.cost})`);
      skipped++;
      continue;
    }

    const newGain = calculateGain(
      order.total_amount,
      order.sale_fee,
      cost.ml_fee_pct,
      cost.cost,
      cost.ml_envio,
      cost.weight_kg,
      cost.dollar_rate
    );

    // Update gain in order_costs
    const { error: updateError } = await supabase
      .from("order_costs")
      .update({ gain: newGain })
      .eq("order_id", order.id);

    if (updateError) {
      console.error(`Error updating order ${order.id}:`, updateError.message);
      errors++;
    } else {
      updated++;
      const date = new Date(order.date_created).toISOString().slice(0, 10);
      const oldGain = cost.gain != null ? `was ${cost.gain.toFixed(2)} → ` : 'null → ';
      console.log(
        `[${date}] Order ${order.id}: ${oldGain}${newGain.toFixed(2)} ARS`
      );
    }
  }

  console.log(`\n✅ Done: ${updated} gains calculated and saved, ${skipped} skipped, ${errors} errors`);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
