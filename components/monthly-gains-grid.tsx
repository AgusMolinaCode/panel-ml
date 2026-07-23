"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { startOfDay, endOfDay, subDays, startOfMonth, subMonths } from "date-fns";
import { Card } from "./ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type RangeMode = "day" | "week" | "month" | "2months" | "3months";

function getRangeFromMode(mode: RangeMode): { fromMs: number; toMs: number } {
  const now = new Date();
  const toMs = endOfDay(now).getTime();
  switch (mode) {
    case "day":
      return { fromMs: startOfDay(now).getTime(), toMs };
    case "week":
      return { fromMs: startOfDay(subDays(now, 6)).getTime(), toMs };
    case "month":
      return { fromMs: startOfDay(startOfMonth(now)).getTime(), toMs };
    case "2months":
      return { fromMs: startOfDay(subMonths(startOfMonth(now), 1)).getTime(), toMs };
    case "3months":
      return { fromMs: startOfDay(subMonths(startOfMonth(now), 2)).getTime(), toMs };
  }
}

interface MonthlyGain {
  month: string;
  orderCount: number;
  totalSales: number;
  totalCosts: number;
  totalGain: number;
}

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
        const res = await fetch(`/api/monthly-gains?from=${fromMs}&to=${toMs}&_=${refreshKey}`);
        const json = (await res.json()) as MonthlyGain[];
        if (!cancelled) setGains(json);
      } catch (err) {
        console.error("Failed to load monthly gains:", err);
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
