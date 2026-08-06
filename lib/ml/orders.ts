import { getCredentials, upsertOrder, getLatestOrderDate, updateOrderClaimStatus } from "../db";
import type { Order, OrderItem, OrderPayment, OrderShipping } from "../db/types";
import { mlGet } from "./client";
import { NotAuthenticatedError } from "./auth";
import { syncShipmentsForOrder } from "./shipments";
import { getOrderClaimStatus } from "./claims";

/**
 * MercadoLibre /orders endpoints wrapper.
 * https://developers.mercadolibre.com.ar/en_us/api-docs/orders
 */

interface MlOrderListResponse {
  results: Array<{ id: number }>;
  paging: { total: number; offset: number; limit: number };
}

interface MlOrderDetail {
  id: number;
  status: string;
  status_detail?: string;
  date_created: string; // ISO
  date_closed?: string;
  last_updated?: string;
  total_amount: number;
  currency_id: string;
  /** Comisión real cobrada por MercadoLibre (viene en la respuesta de /orders/{id}) */
  sale_fee?: number;
  buyer: { id: number; nickname: string };
  order_items: Array<{
    item: {
      id: string;
      title: string;
      category_id?: string;
      variation_id?: number;
      seller_sku?: string | null;
    };
    quantity: number;
    unit_price: number;
    full_unit_price?: number;
    currency_id: string;
    /** Listing type for commission calc: gold_special (Premium), gold_pro (Clásica), free, etc. */
    listing_type_id?: string;
    variation_attributes?: Array<{ id: string; name: string; value_id: string; value_name: string }>;
  }>;
  payments?: Array<{
    id?: number;
    status?: string;
    status_detail?: string;
    transaction_amount?: number;
    currency_id?: string;
    date_approved?: string;
    payment_method_id?: string;
    payment_type_id?: string;
  }>;
  shipping?: {
    id?: number;
    status?: string;
    tracking_number?: string;
    tracking_method?: string;
    logistic_type?: string;
    receiver_address?: Record<string, unknown>;
  };
  /** Tags from the order — see https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas */
  tags?: string[];
}

function parseMlDateToMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

function mapOrder(detail: MlOrderDetail): Omit<Order, "synced_at"> {
  const items: OrderItem[] = detail.order_items.map((oi) => ({
    id: oi.item.id,
    title: oi.item.title,
    quantity: oi.quantity,
    unit_price: oi.unit_price,
    full_unit_price: oi.full_unit_price,
    currency_id: oi.currency_id,
    variation_id: oi.item.variation_id,
    variation_attributes: oi.variation_attributes,
    seller_sku: oi.item.seller_sku ?? null,
  }));

  const payments: OrderPayment[] = (detail.payments ?? []).map((p) => ({
    id: p.id,
    status: p.status,
    status_detail: p.status_detail,
    transaction_amount: p.transaction_amount,
    currency_id: p.currency_id,
    date_approved: p.date_approved,
    payment_method_id: p.payment_method_id,
    payment_type_id: p.payment_type_id,
  }));

  const shipping: OrderShipping | null = detail.shipping
    ? {
        id: detail.shipping.id,
        status: detail.shipping.status,
        tracking_number: detail.shipping.tracking_number,
        tracking_method: detail.shipping.tracking_method,
        logistic_type: detail.shipping.logistic_type,
        receiver_address: detail.shipping.receiver_address,
      }
    : null;

  // listing_type_id from the first item (usually the same across items in the order)
  const listingTypeId = detail.order_items[0]?.listing_type_id ?? null;
  const tags = detail.tags ?? [];

  return {
    id: detail.id,
    status: detail.status,
    status_detail: detail.status_detail,
    date_created: parseMlDateToMs(detail.date_created) ?? Date.now(),
    date_closed: parseMlDateToMs(detail.date_closed),
    last_updated: parseMlDateToMs(detail.last_updated),
    total_amount: detail.total_amount,
    currency_id: detail.currency_id,
    buyer_id: detail.buyer?.id,
    buyer_nickname: detail.buyer?.nickname,
    items,
    payments,
    shipping,
    tags,
    listing_type_id: listingTypeId,
    sale_fee: detail.sale_fee ?? null,
    claim_status: null,
  };
}

/**
 * Fetch recent orders from MercadoLibre and upsert into SQLite.
 * Always re-fetches all orders in the lookback window to catch status changes
 * (cancellations, confirmations, etc.). Returns the number of orders processed.
 */
export async function syncRecentOrders(days = 30, pageLimit = 50): Promise<number> {
  const creds = await getCredentials();
  if (!creds) throw new NotAuthenticatedError();

  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const toStr = to.toISOString().split("T")[0];
  const fromStr = from.toISOString().split("T")[0];

  let offset = 0;
  let processed = 0;
  let hasMore = true;

  while (hasMore) {
    const list = await mlGet<MlOrderListResponse>("/orders/search", {
      seller: creds.user_id,
      sort: "date_desc",
      order: "date_creation",
      "order.date_creation": "date_desc",
      "order.date_creation.from": fromStr,
      "order.date_creation.to": toStr,
      limit: pageLimit,
      offset,
    });

    if (list.results.length === 0) break;

    let pageProcessed = 0;
    for (const ref of list.results) {
      try {
        const detail = await mlGet<MlOrderDetail>(`/orders/${ref.id}`);
        await upsertOrder(mapOrder(detail));
        pageProcessed += 1;
        processed += 1;

        const claimStatus = await getOrderClaimStatus(ref.id);
        if (claimStatus !== null) {
          await updateOrderClaimStatus(ref.id, claimStatus);
        }

        if (detail.tags?.includes("paid") || detail.status === "paid") {
          await syncShipmentsForOrder(ref.id);
        }
      } catch (err) {
        console.error(`[sync-orders] failed to fetch order ${ref.id}:`, err);
      }
    }

    offset += list.results.length;
    hasMore = list.results.length === pageLimit && offset < list.paging.total;
  }

  return processed;
}