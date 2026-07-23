"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { startOfDay, endOfDay, subDays, startOfMonth, subMonths } from "date-fns";
import { OrdersStats } from "./orders-stats";
import type { OrderStats, ShipmentWithOrder } from "@/lib/db/queries";

type RangeMode = "day" | "week" | "month" | "2months" | "3months";

interface Props {
  initialFromMs: number;
  initialToMs: number;
  initialStats: OrderStats;
  initialShipments: ShipmentWithOrder[];
  children?: React.ReactNode;
}

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

export function DashboardClient({
  initialFromMs,
  initialToMs,
  initialStats,
  initialShipments,
  children,
}: Props) {
  const searchParams = useSearchParams();
  const modeFromUrl = searchParams.get("range") as RangeMode | null;
  const activeMode: RangeMode = modeFromUrl ?? "month";

  const { fromMs: currentFromMs, toMs: currentToMs } = getRangeFromMode(activeMode);

  const [stats, setStats] = React.useState<OrderStats>(initialStats);
  const [loading, setLoading] = React.useState(false);

  const fetchStats = React.useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/stats?from=${currentFromMs}&to=${currentToMs}`);
      const json = (await res.json()) as OrderStats;
      if (!cancelled) setStats(json);
    } catch (err) {
      console.error("Failed to load stats:", err);
    } finally {
      if (!cancelled) setLoading(false);
    }
  }, [currentFromMs, currentToMs]);

  React.useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  return (
    <div className="space-y-6">
      <OrdersStats stats={stats} loading={loading} rangeMode={activeMode} />

      {children}
    </div>
  );
}