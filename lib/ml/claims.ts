import { mlGet } from "./client";

interface MlClaim {
  id: number;
  resource_id: number;
  status: "opened" | "closed";
  type: string;
  stage: string;
  resource: string;
  reason_id: string | null;
  date_created: string;
  last_updated: string;
}

interface MlClaimsSearchResponse {
  paging: { total: number; offset: number; limit: number };
  data: MlClaim[];
}

/**
 * Check if an order has an open or closed claim.
 * Returns:
 *   'opened'  — at least one claim is open
 *   'closed'  — only closed claims (or only claims but all closed)
 *   null      — no claims found
 *
 * Docs: https://developers.mercadolibre.com.ar/es_ar/que-es-un-reclamo
 */
export async function getOrderClaimStatus(orderId: number): Promise<"opened" | "closed" | null> {
  try {
    const res = await mlGet<MlClaimsSearchResponse>("/post-purchase/v1/claims/search", {
      order_id: orderId,
      limit: 50,
    });

    if (!res.data || res.data.length === 0) {
      return null;
    }

    const hasOpen = res.data.some((c) => c.status === "opened");
    if (hasOpen) return "opened";

    const hasClosed = res.data.some((c) => c.status === "closed");
    if (hasClosed) return "closed";

    return null;
  } catch {
    return null;
  }
}
