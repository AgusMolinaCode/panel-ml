"use client";

import * as React from "react";
import { endOfDay } from "date-fns";
import { Card } from "./ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { REFRESH_EVENT } from "@/lib/contexts/refresh-context";
import { formatMoney } from "@/lib/format";
import { gainForOrder } from "@/lib/pricing";
import { cn } from "@/lib/utils";

interface MonthlyGain {
  month: string;
  orderCount: number;
  totalSales: number;
  totalCosts: number;
  totalGain: number;
}

type Order = {
  id: number;
  total_amount: number;
  sale_fee: number | null;
  status: string;
  date_created: number;
  claim_status: string | null;
};

type CostData = {
  order_id: number;
  cost: number;
  gain: number | null;
  ml_envio: number | null;
  ml_fee_pct: number;
  weight_kg: number | null;
  dollar_rate: number | null;
};

const MONTH_NAMES: Record<string, string> = {
  "01": "Enero",
  "02": "Febrero",
  "03": "Marzo",
  "04": "Abril",
  "05": "Mayo",
  "06": "Junio",
  "07": "Julio",
  "08": "Agosto",
  "09": "Septiembre",
  "10": "Octubre",
  "11": "Noviembre",
  "12": "Diciembre",
};

function formatMonth(monthStr: string): string {
  const [year, m] = monthStr.split("-");
  const name = MONTH_NAMES[m] ?? m;
  return `${name} ${year}`;
}

interface MonthCardProps {
  gain: MonthlyGain;
  currency: string;
}

function MonthCard({ gain, currency }: MonthCardProps) {
  const marginPct = gain.totalSales > 0 ? (gain.totalGain / gain.totalSales) * 100 : 0;

  return (
    <Card className="min-w-[200px] flex-1">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{formatMonth(gain.month)}</h3>
          <span className="text-xs text-muted-foreground">{gain.orderCount} órdenes</span>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Ventas brutas</span>
            <span className="tabular-nums font-medium">{formatMoney(gain.totalSales, currency)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Costo producto</span>
            <span className="tabular-nums text-destructive">− {formatMoney(gain.totalCosts, currency)}</span>
          </div>
          <div className="border-t border-border/60 pt-1.5 flex justify-between items-center">
            <span className="text-xs font-medium">Ganancia neta</span>
            <span
              className={cn(
                "tabular-nums text-sm font-bold flex items-center gap-1",
                gain.totalGain >= 0 ? "text-success" : "text-destructive"
              )}
            >
              {gain.totalGain >= 0 ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              {formatMoney(gain.totalGain, currency)}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Margen</span>
            <span
              className={cn(
                "tabular-nums text-xs font-medium",
                marginPct >= 20
                  ? "text-success"
                  : marginPct >= 5
                  ? "text-warning"
                  : "text-destructive"
              )}
            >
              {marginPct.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function MonthlyGainsGrid() {
  const [gains, setGains] = React.useState<MonthlyGain[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener("panel-ml:gains-changed", handler);
    window.addEventListener(REFRESH_EVENT, handler);
    return () => {
      window.removeEventListener("panel-ml:gains-changed", handler);
      window.removeEventListener(REFRESH_EVENT, handler);
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        // Cards de MESES COMPLETOS (últimos 3 calendarios) — NO dependen del
        // selector de rango del dashboard. Una card "Septiembre" siempre suma
        // todo septiembre, esté el filtro en día, semana o 3 meses.
        const now = new Date();
        const fromMs = new Date(now.getFullYear(), now.getMonth() - 2, 1).getTime();
        const toMs = endOfDay(now).getTime();

        // Solo estados revenue: canceladas/pendientes de pago no son ganancia.
        const statuses = ["paid", "confirmed", "partially_paid"];
        const allOrders: Order[] = [];
        let offset = 0;
        const limit = 100;

        while (!cancelled) {
          const params = new URLSearchParams({
            from: String(fromMs),
            to: String(toMs),
            limit: String(limit),
            offset: String(offset),
          });
          params.set("status", statuses.join(","));
          const res = await fetch(`/api/orders?${params.toString()}`);
          const json = (await res.json()) as { orders: Order[]; total: number };
          if (!json.orders?.length) break;
          allOrders.push(...json.orders);
          if (allOrders.length >= json.total) break;
          offset += limit;
        }

        if (cancelled || !allOrders.length) {
          if (!cancelled) setGains([]);
          setLoading(false);
          return;
        }

        // Fetch costs for all these orders
        const orderIds = allOrders.map((o) => o.id);
        const costsRes = await fetch(`/api/orders/costs?ids=${orderIds.join(",")}`);
        const costsData = (await costsRes.json()) as Record<number, CostData>;

        // Group orders by LOCAL month and compute gains (same formula as orders-table)
        const monthMap = new Map<string, MonthlyGain>();

        for (const order of allOrders) {
          // Reclamo abierto: la plata está en disputa, no va en la ganancia.
          if (order.claim_status === "opened") continue;

          const cost = costsData[order.id];
          const totalAmount = Number(order.total_amount) || 0;
          // Ganancia manual prioriza. Si no: fórmula nueva desde ago-2026
          // (era IVA), fórmula simple antes de ago-2026 (lib/pricing)
          const gain = cost?.gain != null
            ? cost.gain
            : cost
            ? gainForOrder(Number(order.date_created) || 0, {
                totalAmount,
                saleFee: order.sale_fee,
                mlFeePct: cost.ml_fee_pct,
                costARS: cost.cost,
                mlEnvio: cost.ml_envio,
                weightKg: cost.weight_kg,
                dollarRate: cost.dollar_rate,
              })
            : null;

          // Bucket por mes LOCAL (no UTC: medianoche ART = día anterior en UTC)
          const d = new Date(Number(order.date_created) || 0);
          const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          if (!monthMap.has(monthStr)) {
            monthMap.set(monthStr, {
              month: monthStr,
              orderCount: 0,
              totalSales: 0,
              totalCosts: 0,
              totalGain: 0,
            });
          }
          const m = monthMap.get(monthStr)!;
          m.orderCount++;
          m.totalSales += totalAmount;
          m.totalCosts += cost?.cost ?? 0;
          if (gain != null) m.totalGain += gain;
        }

        const sortedGains = Array.from(monthMap.values()).sort((a, b) => b.month.localeCompare(a.month));
        if (!cancelled) setGains(sortedGains);
      } catch (err) {
        console.error("Failed to load monthly gains:", err);
        if (!cancelled) setGains([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (loading && gains.length === 0) {
    return (
      <div className="flex gap-4 overflow-hidden">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="min-w-[200px] flex-1 h-48 rounded-xl bg-muted animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (gains.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground">
        Sin datos de ganancias para este período
      </div>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {gains.map((gain) => (
        <MonthCard key={gain.month} gain={gain} currency="ARS" />
      ))}
    </div>
  );
}
