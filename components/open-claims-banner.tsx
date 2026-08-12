"use client";

import * as React from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";

interface ClaimOrder {
  id: number;
  buyer_nickname: string | null;
  total_amount: number;
  currency_id: string;
  date_created: number;
  items: Array<{ title: string }>;
}

export function OpenClaimsBanner(): React.ReactElement {
  const [claims, setClaims] = React.useState<ClaimOrder[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

    void fetch(`/api/orders?from=${threeMonthsAgo}&to=${Date.now()}&limit=500&claim_status=opened`)
      .then((res) => res.json())
      .then((data: { orders?: ClaimOrder[] }) => {
        setClaims(data.orders ?? []);
      })
      .catch(() => setClaims([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 animate-pulse">
        <div className="h-4 w-32 rounded bg-destructive/20" />
      </div>
    );
  }

  if (claims.length === 0) {
    return <></>;
  }

  return (
    <div className="rounded-lg border-2 border-destructive/60 bg-destructive/10 p-4 mt-2 animate-fade-in-up">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
        <span className="font-bold text-destructive text-base">
          {claims.length} orden{claims.length === 1 ? "" : "es"} con reclamo abierto
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {claims.map((order) => {
          const firstItem = order.items?.[0]?.title ?? "Sin título";
          return (
            <a
              key={order.id}
              href={`https://www.mercadolibre.com.ar/ventas/omni/listado?filters=&startPeriod=&subFilters=&search=${order.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-destructive/30 bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-destructive/20 transition-colors shadow-sm"
              title={firstItem}
            >
              <span className="font-mono text-destructive font-semibold">#{order.id}</span>
              <span className="text-muted-foreground max-w-[200px] truncate">{firstItem}</span>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            </a>
          );
        })}
      </div>
    </div>
  );
}
