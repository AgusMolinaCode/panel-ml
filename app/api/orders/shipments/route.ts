import { NextRequest, NextResponse } from "next/server";
import { mlGet, MercadoLibreApiError } from "@/lib/ml/client";
import { NotAuthenticatedError } from "@/lib/ml/auth";
import { getShipmentsBulk, upsertShipment } from "@/lib/db";

interface MlShipmentResponse {
  id: number;
  order_id?: number;
  status: string;
  substatus?: string;
  tracking_number?: string;
  logistic_type?: string;
  mode?: string;
  shipping_option?: {
    cost?: number;
    currency_id?: string;
    list_base_cost?: number;
    handling_limit?: string;
    delivery_promise?: { date?: string };
  };
  receiver_address?: Record<string, unknown>;
  shipping_items?: Array<Record<string, unknown>>;
  date_created?: string;
  date_first_printed?: string;
  date_delivered?: string;
}

const SENT_STATUSES = ["delivered", "shipped", "ready_to_ship"];
const PENDING_STATUSES = ["pending", "handling", "cancelled", "not_delivered"];

function parseDate(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * GET /api/orders/shipments?ids=1,2,3
 * Hybrid: checks DB first, then calls ML API only for orders that are
 * missing or not-yet-sent. Newly-sent statuses are upserted to DB.
 * Returns { orderId: { status, tracking_number } | null }.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const idsParam = new URL(req.url).searchParams.get("ids");
    if (!idsParam) {
      return NextResponse.json({ error: "Missing ids param" }, { status: 400 });
    }
    const ids = idsParam.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
    if (ids.length === 0) {
      return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
    }

    const dbMap = getShipmentsBulk(ids);
    const result: Record<number, { status: string; tracking_number: string | null } | null> = {};
    const toCheckWithMl: number[] = [];

    for (const id of ids) {
      const cached = dbMap.get(id);
      if (cached && SENT_STATUSES.includes(cached.status)) {
        result[id] = { status: cached.status, tracking_number: cached.tracking_number };
      } else if (cached && PENDING_STATUSES.includes(cached.status)) {
        result[id] = { status: cached.status, tracking_number: cached.tracking_number };
        toCheckWithMl.push(id);
      } else {
        toCheckWithMl.push(id);
      }
    }

    for (const orderId of toCheckWithMl) {
      try {
        const list = await mlGet<Array<{ id: number }> | MlShipmentResponse>(
          `/orders/${orderId}/shipments`
        );
        const refs = Array.isArray(list) ? list : [list];
        if (refs.length === 0 || refs[0] === null) {
          result[orderId] = null;
          continue;
        }
        const ref = refs[0];
        let status: string;
        let tracking_number: string | null = null;
        if (typeof ref === "object" && "status" in ref) {
          status = (ref as MlShipmentResponse).status;
          tracking_number = (ref as MlShipmentResponse).tracking_number ?? null;
        } else {
          const detail = await mlGet<MlShipmentResponse>(`/shipments/${(ref as { id: number }).id}`);
          status = detail.status;
          tracking_number = detail.tracking_number ?? null;
        }
        result[orderId] = { status, tracking_number };

        if (SENT_STATUSES.includes(status)) {
          upsertShipment({
            id: (ref as { id: number }).id,
            order_id: orderId,
            status,
            substatus: null,
            logistic_type: null,
            mode: null,
            tracking_number,
            tracking_method: null,
            carrier: null,
            cost: null,
            cost_currency: null,
            receiver_address: null,
            shipping_items: null,
            shipping_option: null,
            handling_limit: null,
            date_created: null,
            date_first_printed: null,
            date_delivered: null,
          });
        }
      } catch (err) {
        if (err instanceof NotAuthenticatedError) {
          return NextResponse.json({ error: err.message }, { status: 401 });
        }
        if (err instanceof MercadoLibreApiError && err.status === 404) {
          result[orderId] = null;
          continue;
        }
        console.error(`[api/shipments] order ${orderId} failed:`, err);
        result[orderId] = null;
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
