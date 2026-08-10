"use client";

import * as React from "react";
import { Eye, TrendingUp, TrendingDown, Calendar, Loader2 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { REFRESH_EVENT } from "@/lib/contexts/refresh-context";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ChartTooltip } from "./ui/chart";
import { formatDate } from "@/lib/format";
import type { VisitSummary } from "@/lib/db/queries";

interface Props {
  initialSummary: VisitSummary;
}

export function VisitsWidget({ initialSummary }: Props) {
  const [summary, setSummary] = React.useState<VisitSummary>(initialSummary);
  const [loading, setLoading] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const res = await fetch("/api/visits?days=30");
      const data = (await res.json()) as VisitSummary & { error?: string };
      if (!res.ok || !Array.isArray(data.days)) {
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Listen for global refresh event from DashboardClient
  React.useEffect(() => {
    const handler = (): void => {
      void fetchData();
    };
    window.addEventListener(REFRESH_EVENT, handler);
    return () => window.removeEventListener(REFRESH_EVENT, handler);
  }, [fetchData]);

  async function handleSync(): Promise<void> {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/sync?target=visits", { method: "POST" });
      const data = (await res.json()) as { visits?: number; error?: string };
      if (!res.ok) setError(data.error ?? `Error ${res.status}`);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSyncing(false);
    }
  }

  const chartData = summary.days.map((d) => {
    const isBest = summary.bestDay?.date === d.date;
    const isWorst = summary.worstDay?.date === d.date && d.total > 0;
    return {
      day: d.date.slice(5), // MM-DD
      fullDate: d.date,
      total: d.total,
      fill: isBest ? "#059669" : isWorst ? "#e11d48" : "hsl(var(--muted-foreground))",
    };
  });

  return (
    <Card>
      <CardHeader
        title="Visitas a tus publicaciones"
        description="Últimos 30 días · total agregado del vendedor"
        action={
          <Button onClick={handleSync} loading={syncing} size="sm" variant="secondary">
            {syncing ? null : <Eye className="h-4 w-4" />}
            Sincronizar
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Total 30 días"
            value={summary.totalLast30.toLocaleString("es-AR")}
            icon={<Eye className="h-3.5 w-3.5" />}
          />
          <Stat
            label="Promedio diario"
            value={summary.dailyAvg.toFixed(0)}
            icon={<Calendar className="h-3.5 w-3.5" />}
          />
          {summary.bestDay && (
            <div className="rounded-lg border border-success/40 bg-success/10 p-3">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-success">
                <TrendingUp className="h-3.5 w-3.5" />
                Mejor día
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-success">
                {summary.bestDay.total.toLocaleString("es-AR")}
              </div>
              <div className="text-xs text-success/80">
                {formatDate(Date.parse(summary.bestDay.date + "T12:00:00"))}
              </div>
            </div>
          )}
          {summary.worstDay && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-destructive">
                <TrendingDown className="h-3.5 w-3.5" />
                Peor día
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-destructive">
                {summary.worstDay.total.toLocaleString("es-AR")}
              </div>
              <div className="text-xs text-destructive/80">
                {formatDate(Date.parse(summary.worstDay.date + "T12:00:00"))}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {summary.days.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Eye className="h-8 w-8" />}
            <p className="text-sm">
              {loading ? "Cargando..." : "Sin datos. Hacé click en Sincronizar para traer las últimas 30 jornadas."}
            </p>
          </div>
        ) : (
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="day"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as { fullDate: string; total: number };
                    return (
                      <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
                        <div className="mb-1 font-medium">
                          {formatDate(Date.parse(row.fullDate + "T12:00:00"))}
                        </div>
                        <div className="text-muted-foreground">
                          Visitas:{" "}
                          <span className="font-medium tabular-nums text-foreground">
                            {row.total.toLocaleString("es-AR")}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Verde = mejor día · Rojo = peor día (con visitas). Gris = resto.
        </p>
      </CardBody>
    </Card>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}