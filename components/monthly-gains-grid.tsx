"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { startOfDay, endOfDay, subDays, startOfMonth, subMonths } from "date-fns";
import { Card } from "./ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type RangeMode = "day" | "week" | "month" | "2months" | "3months";

export function getRangeFromMode(mode: RangeMode): { fromMs: number; toMs: number } {
  const now = new Date();
  const toMs = endOfDay(now).getTime();
  switch (mode) {
    case "day":
      return { fromMs: startOfDay(now).getTime(), toMs };
    case "week":
      return { fromMs: startOfDay(subDays(now, 6)).getTime(), toMs };
    case "month":
      return { fromMs: startOfMonth(startOfMonth(now)).getTime(), toMs };
    case "2months":
      return { fromMs: startOfMonth(subMonths(startOfMonth(now), 1)).getTime(), toMs };
    case "3months":
      return { fromMs: startOfMonth(subMonths(startOfMonth(now), 2)).getTime(), toMs };
  }
}

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
};

type CostData = {
  order_id: number;
  cost: number;
  gain: number | null;
  ml_envio: number | null;
  ml_fee_pct: number;
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
  const searchParams = useSearchParams();
  const modeFromUrl = searchParams.get("range") as RangeMode | null;
  const activeMode: RangeMode = modeFromUrl ?? "month";
  const { fromMs, toMs } = getRangeFromMode(activeMode);

  const [gains, setGains] = React.useState<MonthlyGain[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener("panel-ml:gains-changed", handler);
    return () => window.removeEventListener("panel-ml:gains-changed", handler);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        // Fetch ALL orders for the date range (batched, no pagination limit)
        const allOrders: Order[] = [];
        let offset = 0;
        const limit = 100;
        const statuses = ["paid", "confirmed", "partially_paid"];

        while (!cancelled) {
          const params = new URLSearchParams({
            from: String(fromMs),
            to: String(toMs),
            limit: String(limit),
            offset: String(offset),
          });
          for (const s of statuses) params.append("status", s);
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

        // Group orders by month and compute gains (same formula as orders-table)
        const monthMap = new Map<string, MonthlyGain>();

        for (const order of allOrders) {
          const cost = costsData[order.id];
          const totalAmount = Number(order.total_amount) || 0;
          const saleFee = order.sale_fee ?? totalAmount * 0.19;
          const envio = cost?.ml_envio ?? 0;
          const iibb = totalAmount * 0.0025;
          const netSale = totalAmount - saleFee - envio - iibb;
          const calculatedGain = netSale - (cost?.cost ?? 0);
          const gain = cost?.gain != null ? cost.gain : cost ? calculatedGain : null;

          const monthStr = new Date(Number(order.date_created) || 0).toISOString().slice(0, 7);
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
  }, [fromMs, toMs, refreshKey]);

  if (loading) {
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
