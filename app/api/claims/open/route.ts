import { NextResponse } from "next/server";
import { searchOpenClaims, type MlClaim } from "@/lib/ml/claims";
import { mlGet } from "@/lib/ml/client";
import { NotAuthenticatedError } from "@/lib/ml/auth";
import { getSupabase } from "@/lib/supabase";

export interface OpenClaimOrder {
  id: number;
  buyer_nickname: string | null;
  total_amount: number;
  currency_id: string;
  date_created: number;
  items: Array<{ title: string }>;
}

/**
 * GET /api/claims/open
 * Live list of currently-open ML claims for this seller. No date filter.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const claims = await searchOpenClaims();
    const orderIds = await resolveOrderIds(claims);
    const ordersById = await fetchOrdersByIds(orderIds);

    const orders: OpenClaimOrder[] = orderIds.map((id) => {
      const row = ordersById.get(id);
      if (row) return row;
      return {
        id,
        buyer_nickname: null,
        total_amount: 0,
        currency_id: "ARS",
        date_created: 0,
        items: [],
      };
    });

    return NextResponse.json({ orders, total: orders.length });
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function resolveOrderIds(claims: MlClaim[]): Promise<number[]> {
  const orderIds = new Set<number>();
  const shipmentIds: number[] = [];
  const paymentIds: number[] = [];

  for (const claim of claims) {
    if (claim.resource === "order") {
      orderIds.add(claim.resource_id);
    } else if (claim.resource === "shipment") {
      shipmentIds.push(claim.resource_id);
    } else if (claim.resource === "payment") {
      paymentIds.push(claim.resource_id);
    } else {
      // purchase/other — resource_id is not an order id; skip (no bogus chips)
      console.warn(`[claims] unmapped resource type: ${claim.resource} (claim ${claim.id})`);
    }
  }

  // Shipments: DB first, ML fallback. Orders in pending state never had their
  // shipment synced, so a DB-only lookup silently drops their claims.
  if (shipmentIds.length > 0) {
    const supabase = getSupabase();
    const foundInDb = new Set<number>();
    for (const batch of chunk(shipmentIds, 100)) {
      const { data } = await supabase.from("shipments").select("id, order_id").in("id", batch);
      for (const row of (data as Array<{ id: number; order_id: number | null }> | null) ?? []) {
        foundInDb.add(row.id);
        const oid = row.order_id ?? null;
        if (oid) orderIds.add(oid);
      }
    }

    const missing = shipmentIds.filter((id) => !foundInDb.has(id));
    const resolved = await Promise.allSettled(
      missing.map(async (sid) => {
        const ship = await mlGet<{ order_id?: number }>(`/shipments/${sid}`);
        return ship?.order_id ?? null;
      })
    );
    for (const r of resolved) {
      if (r.status === "fulfilled" && r.value) orderIds.add(r.value);
    }
  }

  // Payment claims → resolve payment → order via ML (best effort).
  if (paymentIds.length > 0) {
    const resolved = await Promise.allSettled(
      paymentIds.map(async (pid) => {
        const pay = await mlGet<{ order_id?: number }>(`/payments/${pid}`);
        return pay?.order_id ?? null;
      })
    );
    for (const r of resolved) {
      if (r.status === "fulfilled" && r.value) orderIds.add(r.value);
    }
  }

  return Array.from(orderIds);
}

async function fetchOrdersByIds(ids: number[]): Promise<Map<number, OpenClaimOrder>> {
  const map = new Map<number, OpenClaimOrder>();
  if (ids.length === 0) return map;

  const supabase = getSupabase();
  for (const batch of chunk(ids, 100)) {
    const { data } = await supabase
      .from("orders")
      .select("id, buyer_nickname, total_amount, currency_id, date_created, items_json")
      .in("id", batch);

    for (const row of (data as Array<{
      id: number;
      buyer_nickname: string | null;
      total_amount: number;
      currency_id: string;
      date_created: number;
      items_json: string;
    }> | null) ?? []) {
      let items: Array<{ title: string }> = [];
      try {
        items = JSON.parse(row.items_json) as Array<{ title: string }>;
      } catch {
        items = [];
      }
      map.set(row.id, {
        id: row.id,
        buyer_nickname: row.buyer_nickname,
        total_amount: row.total_amount,
        currency_id: row.currency_id,
        date_created: row.date_created,
        items,
      });
    }
  }

  return map;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
