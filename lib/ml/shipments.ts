import { getCredentials, upsertShipment } from "../db";
import type { Shipment } from "../db/types";
import { mlGet, MercadoLibreApiError } from "./client";
import { NotAuthenticatedError } from "./auth";

/**
 * MercadoLibre Shipments API.
 * https://developers.mercadolibre.com.ar/es_ar/mercado-envios
 *
 * Key endpoints:
 * - GET /orders/{order_id}/shipments  → list of shipments for an order
 * - GET /shipments/{id}               → full shipment details
 *
 * Field reference (verified from /shipments/{id} response):
 * - id, order_id, status, substatus
 * - logistic_type: "cross_docking" | "drop_off" | "self_service" | "fulfillment" | "xd_drop_off" | "default"
 * - mode: "me2" | "me1" | "custom" | "not_specified"
 * - tracking_number, tracking_method
 * - shipping_option.cost (list_base_cost, cost, currency_id)
 * - shipping_option.handling_limit (ISO datetime) ← SLA deadline
 * - shipping_option.delivery_promise (estimated delivery date)
 * - receiver_address
 * - date_created, date_first_printed, date_delivered (ISO datetime)
 */

interface MlShipmentResponse {
  id: number;
  order_id?: number;
  status: string;
  substatus?: string;
  logistic_type?: string;
  mode?: string;
  tracking_number?: string;
  tracking_method?: string;
  carrier?: string;
  shipping_option?: {
    cost?: number;
    currency_id?: string;
    list_base_cost?: number;
    shipping_method_id?: number;
    shipping_method_name?: string;
    handling_limit?: string; // ISO
    delivery_promise?: {
      date?: string;
      time_from?: string;
      time_to?: string;
    };
  };
  receiver_address?: Record<string, unknown>;
  shipping_items?: Array<Record<string, unknown>>;
  date_created?: string;
  date_first_printed?: string;
  date_delivered?: string;
}

function parseDate(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function mapShipment(raw: MlShipmentResponse, orderId: number): Omit<Shipment, "synced_at"> {
  return {
    id: raw.id,
    order_id: orderId,
    status: raw.status,
    substatus: raw.substatus ?? null,
    logistic_type: raw.logistic_type ?? null,
    mode: raw.mode ?? null,
    tracking_number: raw.tracking_number ?? null,
    tracking_method: raw.tracking_method ?? null,
    carrier: raw.carrier ?? null,
    cost: raw.shipping_option?.cost ?? raw.shipping_option?.list_base_cost ?? null,
    cost_currency: raw.shipping_option?.currency_id ?? null,
    receiver_address: raw.receiver_address ?? null,
    shipping_items: raw.shipping_items ?? null,
    shipping_option: raw.shipping_option ?? null,
    handling_limit: parseDate(raw.shipping_option?.handling_limit),
    date_created: parseDate(raw.date_created),
    date_first_printed: parseDate(raw.date_first_printed),
    date_delivered: parseDate(raw.date_delivered),
  };
}

/**
 * Fetch all shipments for a given order, upsert them in the local DB,
 * and return the number of shipments processed.
 */
export async function syncShipmentsForOrder(orderId: number): Promise<number> {
  const list = await mlGet<Array<{ id: number }> | MlShipmentResponse>(
    `/orders/${orderId}/shipments`
  );

  // Endpoint can return either a list of IDs or a single object — handle both.
  const refs: Array<{ id: number }> = Array.isArray(list)
    ? (list as Array<{ id: number }>)
    : [list as { id: number }];

  let count = 0;
  for (const ref of refs) {
    try {
      const detail = ref.id
        ? await mlGet<MlShipmentResponse>(`/shipments/${ref.id}`)
        : (ref as unknown as MlShipmentResponse);
      upsertShipment(mapShipment(detail, orderId));
      count += 1;
    } catch (err) {
      console.error(`[shipments] failed to process shipment for order ${orderId}:`, err);
    }
  }
  return count;
}

export async function syncShipmentsForPaidOrders(limit = 50): Promise<number> {
  // Implemented in worker via lib/db/queries.ts to find paid orders without shipments.
  // Here we just expose a thin wrapper around syncShipmentsForOrder.
  const { getDb } = await import("../db");
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT o.id FROM orders o
        WHERE o.status IN ('paid', 'confirmed', 'partially_paid')
          AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)
        ORDER BY o.date_created DESC
        LIMIT ?`
    )
    .all(limit) as Array<{ id: number }>;

  let total = 0;
  for (const { id } of rows) {
    try {
      total += await syncShipmentsForOrder(id);
    } catch (err) {
      if (err instanceof NotAuthenticatedError || err instanceof MercadoLibreApiError) {
        throw err;
      }
      console.error(`[shipments] order ${id} failed:`, err);
    }
  }
  return total;
}