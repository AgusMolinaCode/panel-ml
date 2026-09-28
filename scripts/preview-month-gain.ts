/**
 * Preview of the NEW monthly-gain logic (matches the fixed grid/expenses):
 * full local month, revenue statuses only, exclude orders with claim_status='opened'.
 * Usage: npx tsx scripts/preview-month-gain.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const { getSupabase } = await import("../lib/supabase");
  const { getOrderCostsBulk } = await import("../lib/db");
  const { gainForOrder } = await import("../lib/pricing");

  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, status, total_amount, sale_fee, date_created, claim_status")
    .in("status", ["paid", "confirmed", "partially_paid"])
    .gte("date_created", new Date(2026, 6, 1).getTime())
    .lte("date_created", new Date(2026, 9, 5).getTime());
  if (error) throw error;

  const costs = await getOrderCostsBulk((rows ?? []).map((r) => r.id));

  interface Bucket { n: number; gain: number; skippedClaims: number; noCost: number }
  const months = new Map<string, Bucket>();

  for (const o of rows ?? []) {
    const d = new Date(Number(o.date_created));
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.set(mk, months.get(mk) ?? { n: 0, gain: 0, skippedClaims: 0, noCost: 0 });
    const b = months.get(mk)!;

    if (o.claim_status === "opened") { b.skippedClaims++; continue; }
    b.n++;

    const cost = costs.get(o.id);
    if (!cost) { b.noCost++; continue; }
    const gain =
      cost.gain != null
        ? cost.gain
        : gainForOrder(Number(o.date_created), {
            totalAmount: Number(o.total_amount) || 0,
            saleFee: o.sale_fee,
            mlFeePct: cost.ml_fee_pct,
            costARS: cost.cost,
            mlEnvio: (cost as { ml_envio?: number | null }).ml_envio ?? null,
            weightKg: (cost as { weight_kg?: number | null }).weight_kg ?? null,
            dollarRate: (cost as { dollar_rate?: number | null }).dollar_rate ?? null,
          });
    b.gain += gain ?? 0;
  }

  const sorted = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  console.log("\nGanancia neta por mes — NUEVA lógica (mes completo local, revenue, sin reclamos abiertos):\n");
  for (const [mk, b] of sorted) {
    console.log(
      `  ${mk}: $${b.gain.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
        `  (${b.n} sumadas, ${b.noCost} sin costo=—, ${b.skippedClaims} reclamo abierto excluida)`
    );
  }
}

main().catch((err) => { console.error("ERR:", err?.message ?? err); process.exit(1); });
