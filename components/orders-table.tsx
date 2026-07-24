"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown, ArrowUp, ArrowDown, Download, Loader2, RefreshCw, FileSpreadsheet, FileText, Copy, ExternalLink, Check } from "lucide-react";
import { startOfDay, endOfDay, subDays, startOfMonth, subMonths } from "date-fns";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "./ui/table";
import { Badge, statusToTone } from "./ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Input } from "./ui/input";
import { OrderDetailModal } from "./order-detail-modal";
import { formatMoney, formatDateTime, translateStatus } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order } from "@/lib/db/types";
import { syncOrdersAction } from "@/app/actions/sync-orders";


type CostData = {
  order_id: number;
  cost: number;
  ml_fee_pct: number;
  notes: string | null;
  gain: number | null;
  updated_at: number;
  weight_kg: number | null;
  logistic_mode: "iva" | "kilos";
  ml_envio: number | null;
  ml_neto: number | null;
  iibb: number | null;
  manual_cost_input?: string | null;
  manual_cost_currency?: string | null;
};

interface OrdersResult {
  orders: Order[];
  total: number;
  limit: number;
  offset: number;
  costs?: Record<number, CostData | null>;
}

type SortBy = "date_created" | "total_amount" | "status" | "id";
type SortDir = "asc" | "desc";
type RangeMode = "day" | "week" | "month" | "2months" | "3months" | "custom";

const ALL_STATUSES = [
  "paid",
  "confirmed",
  "partially_paid",
  "payment_required",
  "payment_in_process",
  "cancelled",
  "invalid",
];

const PAGE_SIZE = 25;
const USD_PER_KG = 15;
const DEFAULT_DOLLAR_RATE = 1600;

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
    default:
      return { fromMs: startOfDay(startOfMonth(now)).getTime(), toMs };
  }
}

interface Props {
  fromMs: number;
  toMs: number;
}

export function OrdersTable({ fromMs: propFromMs, toMs: propToMs }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [rangeMode, setRangeModeState] = React.useState<RangeMode>(() => {
    const urlMode = searchParams.get("range") as RangeMode | null;
    if (urlMode && ["day", "week", "month", "2months", "3months"].includes(urlMode)) {
      return urlMode;
    }
    return "month";
  });
  const [{ fromMs, toMs }, setRange] = React.useState(() => getRangeFromMode(rangeMode));

  const [data, setData] = React.useState<OrdersResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [offset, setOffset] = React.useState(0);
  const [sortBy, setSortBy] = React.useState<SortBy>("date_created");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Order | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [exporting, setExporting] = React.useState<"excel" | "pdf" | null>(null);
  const [costMap, setCostMap] = React.useState<
    Record<number, CostData>
  >({});
  const [shipmentMap, setShipmentMap] = React.useState<
    Record<number, { status: string; tracking_number: string | null } | null>
  >({});
  const [copiedIds, setCopiedIds] = React.useState<Set<number>>(new Set());
  const [copiedSkus, setCopiedSkus] = React.useState<Set<string>>(new Set());
  const latestOrderIdRef = React.useRef<number | null>(null);
  const syncingRef = React.useRef(false);
  const fetchGenRef = React.useRef(0);
  const searchRef = React.useRef(search);
  searchRef.current = search;

  const fetchData = React.useCallback(async (): Promise<void> => {
    const gen = ++fetchGenRef.current;
    const isInitial = data === null;
    if (isInitial) setLoading(true);
    try {
      const params = new URLSearchParams({
        from: String(fromMs),
        to: String(toMs),
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort: sortBy,
        dir: sortDir,
      });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const currentSearch = searchRef.current;
      if (currentSearch) params.set("search", currentSearch);

      const res = await fetch(`/api/orders?${params.toString()}`);
      const json = (await res.json()) as OrdersResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      if (gen !== fetchGenRef.current) return;
      setData(json);
      latestOrderIdRef.current = json.orders[0]?.id ?? null;

      if (json.costs) {
        const map: Record<number, CostData> = {};
        for (const [idStr, cost] of Object.entries(json.costs)) {
          if (cost) map[parseInt(idStr)] = cost as CostData;
        }
        setCostMap(map);
      }

      if (json.orders?.length) {
        const ids = json.orders.map((o) => o.id).join(",");
        const shipmentsRes = await fetch(`/api/orders/shipments?ids=${ids}`);
        if (gen !== fetchGenRef.current) return;
        const shipmentsJson = (await shipmentsRes.json()) as Record<number, { status: string; tracking_number: string | null } | null>;
        setShipmentMap(shipmentsJson);
      }
    } catch (err) {
      if (gen !== fetchGenRef.current) return;
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      if (gen === fetchGenRef.current && isInitial) setLoading(false);
    }
  }, [fromMs, toMs, offset, sortBy, sortDir, statusFilter]);

  React.useEffect(() => {
    setOffset(0);
  }, [fromMs, toMs, statusFilter, search, sortBy, sortDir]);

  // Fetch on mount and when core params change (offset, sort, range)
  React.useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Debounced search — typing won't spam fetches
  React.useEffect(() => {
    const timer = setTimeout(() => {
      void fetchData();
    }, 300);
    return () => clearTimeout(timer);
  }, [search, fetchData]);

  // Sync immediately when tab regains focus (but don't auto-poll)
  React.useEffect(() => {
    const onFocus = (): void => {
      void fetchData();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [fetchData]);

  // Fast-refresh costs when gain is saved from the modal (no full re-fetch)
  React.useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<CostData | number | null>).detail;
      if (!detail) return;
      if (typeof detail === "number") {
        setCostMap((prev) => {
          const next = { ...prev };
          delete next[detail];
          return next;
        });
      } else {
        setCostMap((prev) => ({ ...prev, [detail.order_id]: detail }));
      }
    };
    window.addEventListener("panel-ml:gains-changed", handler);
    return () => window.removeEventListener("panel-ml:gains-changed", handler);
  }, []);

  async function handleSync(): Promise<void> {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setError(null);
    try {
      const result = await syncOrdersAction(90);
      if (!result.success) {
        setError(result.error ?? "Error en sincronización");
        return;
      }
      void fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  function toggleSort(col: SortBy): void {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  }

  function openDetail(order: Order): void {
    setSelected(order);
    setModalOpen(true);
  }

  function onModalChange(open: boolean): void {
    setModalOpen(open);
  }

  async function handleExport(kind: "excel" | "pdf"): Promise<void> {
    setExporting(kind);
    setError(null);
    try {
      const params = new URLSearchParams({
        from: String(fromMs),
        to: String(toMs),
        format: kind,
      });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/orders/export?${params.toString()}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ordenes-${new Date().toISOString().slice(0, 10)}.${kind === "excel" ? "xlsx" : "pdf"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al exportar");
    } finally {
      setExporting(null);
    }
  }

  const total = data?.total ?? 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Card>
        <CardHeader
          title="Órdenes"
          description={`${total} resultado${total === 1 ? "" : "s"} en el rango seleccionado`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSync} loading={syncing} size="sm" variant="secondary">
                {syncing ? null : <RefreshCw className="h-4 w-4" />}
                Sincronizar
              </Button>
              <Button
                onClick={() => handleExport("excel")}
                loading={exporting === "excel"}
                size="sm"
                variant="outline"
              >
                {exporting === "excel" ? null : <FileSpreadsheet className="h-4 w-4" />}
                Excel
              </Button>
              <Button
                onClick={() => handleExport("pdf")}
                loading={exporting === "pdf"}
                size="sm"
                variant="outline"
              >
                {exporting === "pdf" ? null : <FileText className="h-4 w-4" />}
                PDF
              </Button>
            </div>
          }
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border overflow-hidden">
              {(["day", "week", "month", "2months", "3months"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setRangeModeState(mode);
                    setRange(getRangeFromMode(mode));
                    setOffset(0);
                    const params = new URLSearchParams(searchParams.toString());
                    params.set("range", mode);
                    router.push(`?${params.toString()}`, { scroll: false });
                  }}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors",
                    rangeMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  )}
                >
                  {mode === "day" ? "Día" : mode === "week" ? "Semana" : mode === "month" ? "Mes" : mode === "2months" ? "2 meses" : "3 meses"}
                </button>
              ))}
            </div>
            <Input
              placeholder="Buscar por ID o comprador…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <Table>
            <THead>
              <TR>
                <TH>
                  <SortHeader
                    col="date_created"
                    label="Fecha"
                    current={sortBy}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                </TH>
                <TH>
                  <SortHeader
                    col="id"
                    label="Orden"
                    current={sortBy}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                </TH>
                <TH>SKU</TH>
                <TH>Items</TH>
                <TH>
                  <SortHeader
                    col="status"
                    label="Estado"
                    current={sortBy}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                </TH>
                <TH className="text-right">
                  <SortHeader
                    col="total_amount"
                    label="Total"
                    current={sortBy}
                    dir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                </TH>
                <TH className="text-right">NETO ML</TH>
                <TH className="text-right">Ganancia</TH>
              </TR>
            </THead>
            <TBody>
              {loading && !data ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : data?.orders.length === 0 ? (
                <EmptyRow
                  colSpan={8}
                  message="No hay órdenes en este rango con los filtros aplicados."
                />
              ) : (
                data?.orders.map((order) => {
                  const cost = costMap[order.id];
                  const saleFee = order.sale_fee != null
                    ? order.sale_fee
                    : order.total_amount * 0.19;
                  const mlEnvio = cost?.ml_envio ?? 0;
                  const iibb = order.total_amount * 0.0025;
                  const netSale = order.total_amount - saleFee - mlEnvio - iibb;
                  const calculatedGain = netSale - (cost?.cost ?? 0);
                  const gain = cost?.gain != null
                    ? cost.gain
                    : cost
                    ? calculatedGain
                    : null;
                  return (
                    <TR key={order.id} onClick={() => openDetail(order)}>
                      <TD className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(order.date_created)}
                      </TD>
                      <TD className="font-mono text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>#{order.id}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void navigator.clipboard.writeText(String(order.id)).then(() => {
                                setCopiedIds((prev) => new Set(prev).add(order.id));
                                setTimeout(() => {
                                  setCopiedIds((prev) => {
                                    const next = new Set(prev);
                                    next.delete(order.id);
                                    return next;
                                  });
                                }, 1500);
                              });
                            }}
                            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                            title="Copiar número de orden"
                          >
                            {copiedIds.has(order.id) ? (
                              <Check className="h-4 w-4 text-success" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </button>
                          <a
                            href={`https://www.mercadolibre.com.ar/ventas/omni/listado?filters=&startPeriod=&subFilters=&search=${order.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                            title="Abrir en MercadoLibre"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                      </TD>
                      <TD>
                        {(() => {
                          const skus = order.items.map((i) => i.seller_sku).filter(Boolean) as string[];
                          if (!skus.length) return <span className="text-xs text-muted-foreground/40">—</span>;
                          const firstSku = skus[0];
                          const allSkusStr = skus.join(", ");
                          return (
                            <div className="flex items-center gap-1">
                              <span className="font-mono text-xs text-muted-foreground" title={allSkusStr}>
                                {firstSku}{skus.length > 1 && <span className="text-muted-foreground/50"> +</span>}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void navigator.clipboard.writeText(allSkusStr).then(() => {
                                    setCopiedSkus((prev) => new Set(prev).add(firstSku));
                                    setTimeout(() => {
                                      setCopiedSkus((prev) => {
                                        const next = new Set(prev);
                                        next.delete(firstSku);
                                        return next;
                                      });
                                    }, 1500);
                                  });
                                }}
                                className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                                title={`Copiar SKU: ${allSkusStr}`}
                              >
                                {copiedSkus.has(firstSku) ? (
                                  <Check className="h-4 w-4 text-success" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          );
                        })()}
                      </TD>
                      <TD>
                        <div className="max-w-xs truncate text-xs text-muted-foreground">
                          {order.items.map((i) => `${i.quantity}× ${i.title}`).join(", ")}
                        </div>
                      </TD>
                      <TD>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge tone={statusToTone(order.status)}>
                            {translateStatus(order.status)}
                          </Badge>
                          {order.claim_status === "opened" && (
                            <Badge tone="danger" className="text-[10px]">
                              Reclamo abierto
                            </Badge>
                          )}
                          {order.claim_status === "closed" && (
                            <Badge tone="warning" className="text-[10px]">
                              Reclamo cerrado
                            </Badge>
                          )}
                          {(() => {
                            const shipment = shipmentMap[order.id];
                            if (!shipment) return null;
                            const notSent = ["pending", "handling", "cancelled", "not_delivered"].includes(shipment.status);
                            if (notSent) return null;
                            return <Badge tone="success" className="text-[10px]">Enviado</Badge>;
                          })()}
                        </div>
                      </TD>
                      <TD className="text-right">
                        <span className="text-base font-bold tabular-nums">
                          {formatMoney(order.total_amount, order.currency_id)}
                        </span>
                      </TD>
                      <TD className="text-right">
                        {(() => {
                          const envio = cost?.ml_envio ?? 0;
                          const iibb = cost?.iibb ?? (order.total_amount * 0.0025);
                          const saleFee = order.sale_fee ?? (order.total_amount * 0.19);
                          const neto = order.total_amount - saleFee - envio - iibb;
                          return (
                            <span className="text-base font-semibold tabular-nums text-muted-foreground">
                              {formatMoney(neto, order.currency_id)}
                            </span>
                          );
                        })()}
                      </TD>
                      <TD className="text-right">
                        {gain == null ? (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        ) : (
                          <span
                            className={cn(
                              "text-base font-semibold tabular-nums",
                              gain >= 0 ? "text-success" : "text-destructive"
                            )}
                            title={
                              cost
                                ? `Costo: ${formatMoney(cost.cost, order.currency_id)} · Fee ${cost.ml_fee_pct}%`
                                : ""
                            }
                          >
                            {formatMoney(gain, order.currency_id)}
                          </span>
                        )}
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Página {currentPage} de {totalPages} · {total} resultados
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <OrderDetailModal order={selected} open={modalOpen} onOpenChange={onModalChange} />
    </>
  );
}

function SortHeader({
  col,
  label,
  current,
  dir,
  onClick,
  align = "left",
}: {
  col: SortBy;
  label: string;
  current: SortBy;
  dir: SortDir;
  onClick: (col: SortBy) => void;
  align?: "left" | "right";
}) {
  const active = current === col;
  return (
    <button
      type="button"
      onClick={() => onClick(col)}
      className={cn(
        "inline-flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors",
        align === "right" && "ml-auto"
      )}
    >
      {label}
      {active ? (
        dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}