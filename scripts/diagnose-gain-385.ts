/**
 * Which range-window + status combo produces $385.596,28 for the September card?
 * Usage: npx tsx scripts/diagnose-gain-385.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const TARGET = 385596.28;

async function main(): Promise<void> {
  const { getSupabase } = await import("../lib/supabase");
  const { getOrderCostsBulk } = await import("../lib/db");
  const { gainForOrder } = await import("../lib/pricing");

  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, status, total_amount, sale_fee, date_created")
    .gte("date_created", new Date(2026, 7, 15).getTime()) // Aug 15 → now
    .lte("date_created", new Date(2026, 9, 5).getTime());
  if (error) throw error;

  const costs = await getOrderCostsBulk((rows ?? []).map((r) => r.id));

  const computed = (rows ?? []).map((o) => {
    const cost = costs.get(o.id);
    const gain =
      cost?.gain != null
        ? cost.gain
        : cost
        ? gainForOrder(Number(o.date_created) || 0, {
            totalAmount: Number(o.total_amount) || 0,
            saleFee: o.sale_fee,
            mlFeePct: cost.ml_fee_pct,
            costARS: cost.cost,
            mlEnvio: (cost as { ml_envio?: number | null }).ml_envio ?? null,
            weightKg: (cost as { weight_kg?: number | null }).weight_kg ?? null,
            dollarRate: (cost as { dollar_rate?: number | null }).dollar_rate ?? null,
          })
        : null;
    return { id: o.id, status: o.status, ts: Number(o.date_created), gain };
  });

  const now = new Date(); // Sep 27 2026 (server local)
  const windows: Array<{ name: string; from: number; to: number }> = [
    { name: "DÍA (hoy)", from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), to: now.getTime() },
    { name: "SEMANA (últimos 7 días)", from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime(), to: now.getTime() },
    { name: "MES (Sep 1 → ahora)", from: new Date(2026, 8, 1).getTime(), to: now.getTime() },
    { name: "MES entero (Sep 1 → 30)", from: new Date(2026, 8, 1).getTime(), to: new Date(2026, 8, 30, 23, 59, 59, 999).getTime() },
    { name: "2 MESES (Ago 1 → ahora)", from: new Date(2026, 7, 1).getTime(), to: now.getTime() },
    { name: "3 MESES (Jul 1 → ahora)", from: new Date(2026, 6, 1).getTime(), to: now.getTime() },
  ];

  const statusFilters: Array<{ name: string; fn: (s: string) => boolean }> = [
    { name: "solo paid", fn: (s) => s === "paid" },
    { name: "todos", fn: () => true },
  ];

  console.log("Septiembre (UTC bucket 2026-09) bajo cada ventana/estado:\n");
  for (const w of windows) {
    for (const sf of statusFilters) {
      const sel = computed.filter(
        (r) =>
          r.ts >= w.from &&
          r.ts <= w.to &&
          sf.fn(r.status) &&
          new Date(r.ts).toISOString().slice(0, 7) === "2026-09"
      );
      const s = sel.reduce((a, r) => a + (r.gain ?? 0), 0);
      const hit = Math.abs(s - TARGET) < 1 ? " 👈 COINCIDE" : "";
      console.log(`  ${w.name.padEnd(26)} | ${sf.name.padEnd(8)} | ${sel.length} órdenes | $${s.toLocaleString("es-AR", { minimumFractionDigits: 2 })}${hit}`);
    }
  }

  // Also: only stored gains (manual), September full month
  const storedOnly = computed.filter((r) => {
    const c = costs.get(r.id);
    return new Date(r.ts).toISOString().slice(0, 7) === "2026-09" && c?.gain != null;
  });
  const storedSum = storedOnly.reduce((a, r) => a + (r.gain ?? 0), 0);
  console.log(`\n  Solo GANANCIAS STORED (no recalculadas), Sept completo: ${storedOnly.length} órdenes → $${storedSum.toLocaleString("es-AR", { minimumFractionDigits: 2 })}${Math.abs(storedSum - TARGET) < 1 ? " 👈 COINCIDE" : ""}`);

  const recomputed = computed.filter((r) => {
    const c = costs.get(r.id);
    return new Date(r.ts).toISOString().slice(0, 7) === "2026-09" && c && c.gain == null;
  });
  console.log(`  Recalculadas (cost sin gain) Sept: ${recomputed.length} → $${recomputed.reduce((a, r) => a + (r.gain ?? 0), 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`);
  console.log(`  Sin costo: ${computed.filter((r) => new Date(r.ts).toISOString().slice(0, 7) === "2026-09" && !costs.get(r.id)).length}`);
}

main().catch((err) => {
  console.error("ERR:", err?.message ?? err);
  process.exit(1);
});
