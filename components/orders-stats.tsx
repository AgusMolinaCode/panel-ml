"use client";

import * as React from "react";
import {
  TrendingUp,
  CheckCircle2,
  Truck,
  XCircle,
  DollarSign,
  Package,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import { Card, CardBody } from "./ui/card";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OrderStats } from "@/lib/db/queries";

type RangeMode = "day" | "week" | "month" | "2months" | "3months";

interface Props {
  stats: OrderStats;
  loading?: boolean;
  rangeMode?: RangeMode;
}

interface Kpi {
  label: string;
  value: string;
  subtext?: string;
  icon: LucideIcon;
  tone: "primary" | "success" | "warning" | "danger" | "info";
  /** Optional numeric trend (% vs previous period). */
  trend?: number;
}

export function OrdersStats({ stats, loading = false, rangeMode = "month" }: Props) {
  const byStatus = Object.fromEntries(stats.byStatus.map((s) => [s.status, s]));

  const paid = byStatus["paid"]?.count ?? 0;
  const confirmed = byStatus["confirmed"]?.count ?? 0;
  const cancelled = byStatus["cancelled"]?.count ?? 0;
  const pendingCancel = byStatus["pending_cancel"]?.count ?? 0;
  const totalCancelled = cancelled + pendingCancel;

  const fulfillmentRate = stats.total > 0 ? ((paid + confirmed) / stats.total) * 100 : 0;
  const cancelRate = stats.total > 0 ? (totalCancelled / stats.total) * 100 : 0;
  const avgDispatchDays =
    stats.avgDispatchTimeMs != null
      ? stats.avgDispatchTimeMs / (1000 * 60 * 60 * 24)
      : null;

  const ticketPromedio = paid + confirmed > 0 ? stats.totalRevenue / (paid + confirmed) : 0;

  const RANGE_LABELS: Record<RangeMode, { ventas: string; total: string }> = {
    day: { ventas: "Ventas día", total: "Total día" },
    week: { ventas: "Ventas semana", total: "Total semana" },
    month: { ventas: "Ventas mes", total: "Total mes" },
    "2months": { ventas: "Ventas 2 meses", total: "Total 2 meses" },
    "3months": { ventas: "Ventas 3 meses", total: "Total 3 meses" },
  };
  const labels = RANGE_LABELS[rangeMode] ?? RANGE_LABELS.month;

  const kpis: Kpi[] = [
    {
      label: "Facturación aprobada",
      value: formatMoney(stats.totalRevenue, stats.currency),
      subtext: `Solo pagos confirmados`,
      icon: DollarSign,
      tone: "success",
    },
    {
      label: "Ventas brutas",
      value: formatMoney(stats.grossSales, stats.currency),
      subtext: `${stats.grossBreakdown.processed.count} procesadas · ${stats.grossBreakdown.pending.count} pendientes · ${stats.grossBreakdown.cancelled.count} canceladas`,
      icon: TrendingUp,
      tone: "primary",
    },
    {
      label: "Ticket promedio",
      value: formatMoney(ticketPromedio, stats.currency),
      subtext: `${paid + confirmed} ventas concretadas`,
      icon: CheckCircle2,
      tone: "info",
    },
    {
      label: "Tasa de concreción",
      value: `${fulfillmentRate.toFixed(1)}%`,
      subtext:
        avgDispatchDays != null
          ? `Despacho prom. ${avgDispatchDays.toFixed(1)} días`
          : "Sin despachos",
      icon: Truck,
      tone: fulfillmentRate >= 70 ? "info" : "warning",
    },
    {
      label: labels.ventas,
      value: stats.grossBreakdown.processed.count.toString(),
      subtext: `${stats.grossBreakdown.processed.count} procesadas`,
      icon: CheckCircle2,
      tone: "success",
    },
    {
      label: labels.total,
      value: stats.total.toString(),
      subtext: `${stats.grossBreakdown.processed.count} procesadas · ${stats.grossBreakdown.pending.count} pendientes · ${stats.grossBreakdown.pendingCancel.count} cancelac. abiertas · ${cancelled} canceladas`,
      icon: Package,
      tone: cancelRate > 15 ? "danger" : cancelRate > 0 ? "warning" : "success",
    },
    {
      label: "Compradores únicos",
      value: stats.topBuyers.length.toString(),
      subtext: stats.topBuyers[0]
        ? `Top: ${stats.topBuyers[0].buyer_nickname ?? `#${stats.topBuyers[0].buyer_id}`}`
        : "—",
      icon: CreditCard,
      tone: "primary",
    },
  ];

  return (
    <div className="stagger-children grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {loading
        ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
        : kpis.map((kpi) => <KpiCard key={kpi.label} kpi={kpi} />)}
    </div>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <CardBody className="space-y-2.5 p-4">
        <div className="flex items-center justify-between">
          <div className="h-3 w-20 rounded bg-muted animate-pulse" />
          <div className="h-7 w-7 rounded-lg bg-muted animate-pulse" />
        </div>
        <div className="h-7 w-28 rounded bg-muted animate-pulse" />
        <div className="h-3 w-36 rounded bg-muted animate-pulse" />
      </CardBody>
    </Card>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const toneClasses: Record<Kpi["tone"], string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-destructive/10 text-destructive",
    info: "bg-info/10 text-info",
  };

  const accentClasses: Record<Kpi["tone"], string> = {
    primary: "from-primary/20",
    success: "from-success/20",
    warning: "from-warning/20",
    danger: "from-destructive/20",
    info: "from-info/20",
  };

  const Icon = kpi.icon;

  return (
    <Card className="overflow-hidden group">
      {/* Subtle gradient accent strip on top-left */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-12 -left-12 h-24 w-24 rounded-full bg-gradient-to-br to-transparent blur-2xl opacity-60",
          accentClasses[kpi.tone]
        )}
      />
      <CardBody className="relative space-y-2.5 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {kpi.label}
          </span>
          <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", toneClasses[kpi.tone])}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className="text-2xl font-bold tabular-nums tracking-tight">{kpi.value}</div>
        {kpi.subtext && (
          <div className="text-xs text-muted-foreground truncate">{kpi.subtext}</div>
        )}
      </CardBody>
    </Card>
  );
}