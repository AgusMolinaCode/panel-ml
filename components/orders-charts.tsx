"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { Card, CardBody, CardHeader } from "./ui/card";
import { ChartTooltip } from "./ui/chart";
import { formatMoney, formatDate } from "@/lib/format";
import type { OrderStats } from "@/lib/db/queries";

const STATUS_COLORS: Record<string, string> = {
  paid: "#10b981",
  confirmed: "#14b8a6",
  partially_paid: "#84cc16",
  payment_required: "#f59e0b",
  payment_in_process: "#eab308",
  cancelled: "#f43f5e",
  invalid: "#a1a1aa",
  delivered: "#3b82f6",
};

const STATUS_LABELS: Record<string, string> = {
  paid: "Pagada",
  confirmed: "Confirmada",
  partially_paid: "Pago parcial",
  payment_required: "Pago requerido",
  payment_in_process: "Pago en proceso",
  cancelled: "Cancelada",
  invalid: "Inválida",
  delivered: "Entregada",
};

interface Props {
  stats: OrderStats;
}

export function OrdersCharts({ stats }: Props) {
  const pieData = stats.byStatus.map((s) => ({
    name: STATUS_LABELS[s.status] ?? s.status,
    value: s.count,
    status: s.status,
    color: STATUS_COLORS[s.status] ?? "var(--muted-foreground)",
  }));

  const lineData = stats.byDay.map((d) => ({
    day: d.day,
    dayShort: d.day.slice(5), // MM-DD
    count: d.count,
    revenue: d.revenue,
  }));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Distribución por estado"
          description={`${stats.total} órdenes en el período`}
        />
        <CardBody>
          {pieData.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Sin datos en el rango seleccionado
            </p>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="hsl(var(--background))" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    wrapperStyle={{ fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Evolución temporal"
          description="Cantidad de órdenes y facturación por día"
        />
        <CardBody>
          {lineData.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Sin datos en el rango seleccionado
            </p>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="dayShort"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as { day: string; count: number; revenue: number };
                      return (
                        <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
                          <div className="mb-1 font-medium">{formatDate(Date.parse(row.day))}</div>
                          <div className="text-muted-foreground">
                            Órdenes: <span className="font-medium tabular-nums text-foreground">{row.count}</span>
                          </div>
                          <div className="text-muted-foreground">
                            Facturado: <span className="font-medium tabular-nums text-foreground">
                              {formatMoney(row.revenue, stats.currency)}
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="count"
                    name="Órdenes"
                    stroke="#4f46e5"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="revenue"
                    name="Facturación"
                    stroke="#059669"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}