"use client";

import * as React from "react";
import { ShoppingCart, Loader2, ArrowRight } from "lucide-react";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { formatMoney, formatDateTime } from "@/lib/format";
import type { IntentOrder } from "@/lib/db/queries";

interface Props {
  initialOrders: IntentOrder[];
  initialTotal: number;
  initialCurrency: string;
}

export function IntentOrders({ initialOrders, initialTotal, initialCurrency }: Props) {
  const [orders, setOrders] = React.useState<IntentOrder[]>(initialOrders);
  const [total, setTotal] = React.useState(initialTotal);
  const [currency, setCurrency] = React.useState(initialCurrency);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const res = await fetch("/api/orders/intent");
      const data = (await res.json()) as {
        orders?: IntentOrder[];
        total_amount?: number;
        currency?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setOrders(data.orders ?? []);
      setTotal(data.total_amount ?? 0);
      setCurrency(data.currency ?? "ARS");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchData();
    const t = setInterval(fetchData, 5 * 60_000);
    return () => clearInterval(t);
  }, [fetchData]);

  return (
    <Card>
      <CardHeader
        title="Intención de compra"
        description="Órdenes creadas pero sin pago confirmado (suelen expirar en 24-48hs)"
      />
      <CardBody className="space-y-3">
        {orders.length === 0 && !loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Ninguna orden esperando pago. Cuando haya compradores que crearon la orden
            pero no pagaron, aparecerán acá para que les mandes recordatorio.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-warning" />
                <span className="text-sm font-medium">{orders.length} órdenes esperando pago</span>
              </div>
              <span className="text-lg font-bold tabular-nums">{formatMoney(total, currency)}</span>
            </div>

            {loading && orders.length === 0 && (
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}

            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {orders.slice(0, 10).map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-xs">#{o.id}</span>
                      <span className="truncate text-muted-foreground">
                        {o.buyer_nickname ?? `#${o.buyer_id}`}
                      </span>
                      <Badge tone="warning">{o.status === "payment_required" ? "Esperando pago" : "Procesando"}</Badge>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {o.items_summary}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {formatDateTime(o.date_created)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatMoney(o.total_amount, o.currency_id)}
                    </span>
                    <a
                      href={`https://www.mercadolibre.com.ar/ventas/${o.id}/detalle`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      Ver
                      <ArrowRight className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
            {orders.length > 10 && (
              <p className="pt-2 text-center text-xs text-muted-foreground">
                +{orders.length - 10} más
              </p>
            )}
          </>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </CardBody>
    </Card>
  );
}