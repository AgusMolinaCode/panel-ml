"use client";

import * as React from "react";
import { Truck, Loader2, AlertTriangle, Clock, ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { REFRESH_EVENT } from "@/lib/contexts/refresh-context";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { formatMoney, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ShipmentWithOrder } from "@/lib/db/queries";

interface Props {
  initialShipments: ShipmentWithOrder[];
}

type SortOrder = "newest" | "oldest";

function timeUntil(handlingLimitMs: number | null, logisticType: string | null): {
  label: string;
  tone: "danger" | "warning" | "default" | "info";
} {
  if (handlingLimitMs == null) {
    const isDropOff =
      logisticType === "xd_drop_off" ||
      logisticType === "drop_off" ||
      logisticType === "cross_docking";
    return { label: isDropOff ? "Esperando carrier" : "Sin límite", tone: "info" };
  }
  const ms = handlingLimitMs - Date.now();
  if (ms <= 0) return { label: "Vencido", tone: "danger" };
  const hours = ms / (1000 * 60 * 60);
  if (hours < 24) return { label: `${Math.round(hours)}h restantes`, tone: "danger" };
  if (hours < 48) return { label: `${Math.round(hours)}h restantes`, tone: "warning" };
  const days = Math.floor(hours / 24);
  return { label: `${days}d restantes`, tone: "default" };
}

const PAGE_SIZE = 20;

export function ShipmentsDue({ initialShipments }: Props) {
  const [shipments, setShipments] = React.useState<ShipmentWithOrder[]>(initialShipments);
  const [total, setTotal] = React.useState<number>(initialShipments.length);
  const [loading, setLoading] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("newest");
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);

  // Re-render every minute so SLA countdowns stay accurate
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const fetchData = React.useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const res = await fetch("/api/shipments?limit=1000");
      const data = (await res.json()) as {
        shipments?: ShipmentWithOrder[];
        total?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setShipments(data.shipments ?? []);
      setTotal(data.total ?? data.shipments?.length ?? 0);
      setVisibleCount(PAGE_SIZE);
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

  React.useEffect(() => {
    const onFocus = (): void => {
      void fetchData();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [fetchData]);

  async function handleSync(): Promise<void> {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/sync?target=shipments", { method: "POST" });
      const data = (await res.json()) as { shipments?: number; error?: string };
      if (!res.ok) setError(data.error ?? `Error ${res.status}`);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSyncing(false);
    }
  }

  // Sort the list (the API already returns newest first; client just flips if needed)
  const sorted = React.useMemo(() => {
    const copy = [...shipments];
    copy.sort((a, b) => {
      const aMs = a.date_order_created;
      const bMs = b.date_order_created;
      return sortOrder === "newest" ? bMs - aMs : aMs - bMs;
    });
    return copy;
  }, [shipments, sortOrder]);

  // Stats computed from the full set (not paginated) so counters are accurate
  const overdue = shipments.filter(
    (s) => s.handling_limit != null && s.handling_limit < Date.now()
  ).length;
  const dueSoon = shipments.filter((s) => {
    if (s.handling_limit == null) return false;
    const ms = s.handling_limit - Date.now();
    return ms > 0 && ms < 48 * 60 * 60 * 1000;
  }).length;
  const noDeadline = shipments.filter((s) => s.handling_limit == null).length;
  const ok = shipments.length - overdue - dueSoon - noDeadline;

  // Infinite scroll: when sentinel is visible, load more
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (visibleCount >= total) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + PAGE_SIZE, total));
        }
      },
      { rootMargin: "200px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, total]);

  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < total;

  return (
    <Card>
      <CardHeader
        title="Próximos a enviar"
        description="Envíos pendientes — se cargan a medida que hacés scroll"
        action={
          <Button onClick={handleSync} loading={syncing} size="sm" variant="secondary">
            {syncing ? null : <Truck className="h-4 w-4" />}
            Sincronizar envíos
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Counter label="Vencidos" value={overdue} tone="danger" icon={<AlertTriangle className="h-3.5 w-3.5" />} />
          <Counter label="≤ 48hs" value={dueSoon} tone="warning" icon={<Clock className="h-3.5 w-3.5" />} />
          <Counter label="En tiempo" value={ok} tone="success" icon={<Truck className="h-3.5 w-3.5" />} />
          <Counter label="Sin límite" value={noDeadline} tone="info" icon={<Truck className="h-3.5 w-3.5" />} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {shipments.length === 0
              ? "Sin envíos pendientes"
              : total > shipments.length
                ? `Mostrando ${visible.length} de ${total} — scroll para cargar más`
                : `Mostrando ${visible.length} de ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Orden:</span>
            <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as SortOrder)}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">
                  <span className="flex items-center gap-2">
                    <ArrowDownAZ className="h-3.5 w-3.5" /> Más nuevo primero
                  </span>
                </SelectItem>
                <SelectItem value="oldest">
                  <span className="flex items-center gap-2">
                    <ArrowUpAZ className="h-3.5 w-3.5" /> Más viejo primero
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && shipments.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : shipments.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin envíos pendientes. Cuando entre una orden pagada, aparecerá acá.
          </p>
        ) : (
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {visible.map((s) => {
              const t = timeUntil(s.handling_limit, s.logistic_type);
              return (
                <div
                  key={s.id}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5",
                    t.tone === "danger" && "border-destructive/40 bg-destructive/5",
                    t.tone === "warning" && "border-warning/40 bg-warning/5",
                    t.tone === "info" && "border-info/30 bg-info/5"
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        #{s.order_id}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {s.buyer_nickname ?? `ID ${s.buyer_id}`}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">
                        · {formatDateTime(s.date_order_created)}
                      </span>
                    </div>
                    <div className="truncate text-xs text-foreground/80">
                      {s.items_summary.slice(0, 80)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      {s.tags.includes("paid") && <Badge tone="success">paid</Badge>}
                      {s.tags.includes("not_delivered") && <Badge tone="warning">not_delivered</Badge>}
                      {s.tags.includes("delivered") && <Badge tone="info">delivered</Badge>}
                      {s.tags.includes("no_shipping") && <Badge tone="default">no_shipping</Badge>}
                      {s.tags.includes("fraud_risk_detected") && <Badge tone="danger">fraud_risk</Badge>}
                      <Badge tone="default">{s.logistic_type ?? s.mode ?? "—"}</Badge>
                      {s.tracking_number && (
                        <span className="font-mono text-muted-foreground">{s.tracking_number}</span>
                      )}
                      {s.handling_limit != null && (
                        <span className="text-muted-foreground">
                          Límite: {formatDateTime(s.handling_limit)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-lg font-bold tabular-nums text-foreground">
                      {formatMoney(s.total_amount, s.currency_id)}
                    </span>
                    <Badge tone={t.tone}>{t.label}</Badge>
                  </div>
                </div>
              );
            })}

            {hasMore && (
              <>
                <div
                  ref={sentinelRef}
                  aria-hidden
                  className="flex h-8 items-center justify-center"
                >
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-xs text-muted-foreground">
                    Cargando más…
                  </span>
                </div>
              </>
            )}
            {!hasMore && total > PAGE_SIZE && (
              <p className="pt-2 text-center text-xs text-muted-foreground">
                Fin de la lista · {total} envíos en total
              </p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Counter({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger" | "info";
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          tone === "danger" && "text-destructive",
          tone === "warning" && "text-warning",
          tone === "info" && "text-info"
        )}
      >
        {value}
      </div>
    </div>
  );
}