/**
 * Diagnostic: why does the September card in monthly-gains-grid not match
 * the sum of the Ganancia column in orders-table?
 * Computes the same month under 4 strategies and diffs them.
 * Usage: npx tsx scripts/diagnose-month-gain.ts [YYYY-MM]
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const MONTH = process.argv[2] ?? "2026-09";

async function main(): Promise<void> {
  const { getSupabase } = await import("../lib/supabase");
  const { getOrderCostsBulk } = await import("../lib/db");
  const { gainForOrder } = await import("../lib/pricing");

  const supabase = getSupabase();
  const [year, month] = MONTH.split("-").map(Number);

  // LOCAL month boundaries (what the table's "Mes" filter and the user's head use)
  const localFrom = new Date(year, month - 1, 1).getTime();
  const localTo = new Date(year, month, 0, 23, 59, 59, 999).getTime();
  // WIDER window to catch UTC-bucket leakage (±1 day)
  const wideFrom = localFrom - 2 * 86_400_000;
  const wideTo = localTo + 2 * 86_400_000;

  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, status, total_amount, sale_fee, date_created")
    .gte("date_created", wideFrom)
    .lte("date_created", wideTo);
  if (error) throw error;
  const orders = rows ?? [];

  const costs = await getOrderCostsBulk(orders.map((o) => o.id));

  interface Row {
    id: number;
    status: string;
    gain: number | null;
    localBucket: string;
    utcBucket: string;
    inLocalMonth: boolean;
    hasCost: boolean;
  }

  const computed: Row[] = orders.map((o) => {
    const cost = costs.get(o.id);
    const totalAmount = Number(o.total_amount) || 0;
    const gain =
      cost?.gain != null
        ? cost.gain
        : cost
        ? gainForOrder(Number(o.date_created) || 0, {
            totalAmount,
            saleFee: o.sale_fee,
            mlFeePct: cost.ml_fee_pct,
            costARS: cost.cost,
            mlEnvio: (cost as { ml_envio?: number | null }).ml_envio ?? null,
            weightKg: (cost as { weight_kg?: number | null }).weight_kg ?? null,
            dollarRate: (cost as { dollar_rate?: number | null }).dollar_rate ?? null,
          })
        : null;
    const d = new Date(Number(o.date_created) || 0);
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const utc = d.toISOString().slice(0, 7);
    const ts = Number(o.date_created);
    return { id: o.id, status: o.status, gain, localBucket: local, utcBucket: utc, inLocalMonth: ts >= localFrom && ts <= localTo, hasCost: !!cost };
  });

  const sum = (xs: Row[]) => xs.reduce((a, r) => a + (r.gain ?? 0), 0);
  const fmt = (n: number) => `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  console.log(`\n=== ${MONTH} — ${orders.length} orders in wide window ===`);

  // A) TABLE (default view "Mes" + status "all"): local month range, ALL statuses, every order with a gain value
  const tableAll = computed.filter((r) => r.inLocalMonth);
  console.log(`\n[A] TABLA mes local, TODOS los statuses: ${tableAll.length} órdenes → ${fmt(sum(tableAll))}`);
  const byStatus: Record<string, { n: number; sum: number }> = {};
  for (const r of tableAll) {
    byStatus[r.status] ??= { n: 0, sum: 0 };
    byStatus[r.status].n++;
    byStatus[r.status].sum += r.gain ?? 0;
  }
  for (const [s, v] of Object.entries(byStatus).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`    ${s}: ${v.n} órdenes → ${fmt(v.sum)}`);
  }

  // B) GRID as coded: orders fetched by range (local boundaries via API? NO — grid sends from/to local ms too),
  //    but BUCKETS by UTC month and keeps only status=paid (status-param bug: first value only).
  const gridPaidOnly = computed.filter((r) => r.utcBucket === MONTH && r.status === "paid" && r.inLocalMonth !== undefined);
  const gridAllStatuses = computed.filter((r) => r.utcBucket === MONTH);
  console.log(`\n[B] GRID (UTC bucket "${MONTH}", solo PAID por bug status): ${gridPaidOnly.length} → ${fmt(sum(gridPaidOnly))}`);
  console.log(`[B2] GRID (UTC bucket, todos los statuses): ${gridAllStatuses.length} → ${fmt(sum(gridAllStatuses))}`);

  // C) Correct: local month, revenue statuses (paid/confirmed/partially_paid)
  const REVENUE = new Set(["paid", "confirmed", "partially_paid"]);
  const localRevenue = computed.filter((r) => r.localBucket === MONTH && REVENUE.has(r.status));
  console.log(`\n[C] LOCAL month + revenue statuses: ${localRevenue.length} → ${fmt(sum(localRevenue))}`);

  // D) Differences that matter
  console.log(`\n[D] Diffs:`);
  const utcLeak = computed.filter((r) => r.localBucket === MONTH && r.utcBucket !== MONTH);
  const utcGain = computed.filter((r) => r.localBucket !== MONTH && r.utcBucket === MONTH);
  console.log(`    Órdenes de ${MONTH} (local) que el UTC bucket manda a OTRO mes: ${utcLeak.length}`);
  for (const r of utcLeak) console.log(`      #${r.id} ${r.status} gain=${r.gain != null ? fmt(r.gain) : "—"} bucketUTC=${r.utcBucket}`);
  console.log(`    Órdenes de OTRO mes local que el UTC bucket mete en ${MONTH}: ${utcGain.length}`);
  for (const r of utcGain) console.log(`      #${r.id} ${r.status} gain=${r.gain != null ? fmt(r.gain) : "—"} local=${r.localBucket}`);

  const notPaid = tableAll.filter((r) => r.status !== "paid" && r.gain != null && REVENUE.has(r.status));
  console.log(`    Revenue PERO no "paid" (el grid las descarta): ${notPaid.length} → ${fmt(sum(notPaid))}`);
  for (const r of notPaid) console.log(`      #${r.id} ${r.status} gain=${fmt(r.gain ?? 0)}`);

  const nonRevenue = tableAll.filter((r) => !REVENUE.has(r.status) && r.gain != null);
  console.log(`    NON-revenue con ganancia visible en tabla (pagos pendientes/canceladas): ${nonRevenue.length} → ${fmt(sum(nonRevenue))}`);
  for (const r of nonRevenue.slice(0, 15)) console.log(`      #${r.id} ${r.status} gain=${fmt(r.gain ?? 0)} hasCost=${r.hasCost}`);
}

main().catch((err) => {
  console.error("ERR:", err?.message ?? err);
  process.exit(1);
});
