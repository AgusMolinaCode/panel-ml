import { getCredentials } from "../db";
import { NotAuthenticatedError } from "./auth";
import { mlGet } from "./client";

export interface MlClaim {
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

const SEARCH_PAGE = 50;

/**
 * All open claims for the authenticated seller.
 * ML requires players.user_id + players.role as the base filter — status=opened
 * alone is invalid/expensive. No date window: if it's open, it comes back.
 *
 * Docs: https://developers.mercadolibre.com.ar/es_ar/que-es-un-reclamo
 */
export async function searchOpenClaims(): Promise<MlClaim[]> {
  const creds = await getCredentials();
  if (!creds) throw new NotAuthenticatedError();

  const all: MlClaim[] = [];
  let offset = 0;

  while (offset + SEARCH_PAGE < 10_000) {
    const res = await mlGet<MlClaimsSearchResponse>("/post-purchase/v1/claims/search", {
      "players.user_id": creds.user_id,
      "players.role": "respondent",
      status: "opened",
      limit: SEARCH_PAGE,
      offset,
      sort: "last_updated:desc",
    });

    const page = res.data ?? [];
    all.push(...page);

    const total = res.paging?.total ?? all.length;
    offset += page.length;
    if (page.length === 0 || offset >= total) break;
  }

  return all;
}

/**
 * Check if an order has an open or closed claim.
 * Returns:
 *   'opened'  — at least one claim is open
 *   'closed'  — only closed claims
 *   null      — no claims found
 *
 * Throws on ML API errors. Callers MUST NOT treat a failure as "no claim"
 * (that used to wipe claim_status in the DB).
 */
export async function getOrderClaimStatus(orderId: number): Promise<"opened" | "closed" | null> {
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
}
