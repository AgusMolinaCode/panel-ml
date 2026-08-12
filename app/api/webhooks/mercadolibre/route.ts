import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { config } from "@/lib/config";
import { mlGet } from "@/lib/ml/client";
import { upsertOrder, updateOrderClaimStatus, updateShipmentStatus, clearOrderGain } from "@/lib/db";
import { getOrderClaimStatus } from "@/lib/ml/claims";
import { syncShipmentsForOrder } from "@/lib/ml/shipments";
import { broadcast } from "@/lib/sse/emitter";
import type { Order, OrderItem, OrderPayment, OrderShipping } from "@/lib/db/types";

interface MlOrderDetail {
  id: number;
  status: string;
  status_detail?: string;
  date_created: string;
  date_closed?: string;
  last_updated?: string;
  total_amount: number;
  currency_id: string;
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
  tags?: string[];
}

interface MlShipment {
  id: number;
  order_id: number;
  status: string;
  tracking_number?: string;
  status_history?: Array<{ status: string; date: string }>;
}

function parseMlDateToMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

type UpsertableOrder = Omit<Order, "synced_at" | "claim_status"> & {
  /** undefined = do not touch the existing claim_status on upsert */
  claim_status?: "opened" | "closed" | null | undefined;
};

function mapOrder(detail: MlOrderDetail): UpsertableOrder {
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
    tags: detail.tags ?? [],
    listing_type_id: detail.order_items[0]?.listing_type_id ?? null,
    sale_fee: detail.sale_fee ?? null,
    claim_status: undefined,
  };
}

function verifyMlSignature(req: NextRequest, body: string): boolean {
  const sig256 = req.headers.get("x-signature-256");
  const sig = req.headers.get("x-signature");
  if (!sig256 && !sig) return false;

  const secret = config.ml.clientSecret;
  const userId = req.headers.get("x-real-user-id") ?? "";

  const signedString = `${userId}-${body}-${secret}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedString)
    .digest("hex");

  const received = (sig256 ?? sig ?? "").replace("sha256=", "").split(",")[0];
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  const topic = req.headers.get("x-topic") ?? "";
  const resource = req.headers.get("x-resource-id") ?? "";

  // Verify webhook signature (skip in development if no signature present)
  if (process.env.NODE_ENV === "production" && !verifyMlSignature(req, body)) {
    console.warn("[webhook] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  console.log(`[webhook] Received topic=${topic} resource=${resource}`);

  try {
    if (topic === "orders_v2" && resource) {
      const orderId = parseInt(resource.split("/").pop() ?? "0", 10);
      if (orderId) {
        await syncOrder(orderId);
      }
    } else if (topic === "shipments" && resource) {
      const shipmentId = parseInt(resource.split("/").pop() ?? "0", 10);
      if (shipmentId) {
        await syncShipment(shipmentId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook] Error processing notification:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function syncOrder(orderId: number): Promise<void> {
  const detail = await mlGet<MlOrderDetail>(`/orders/${orderId}`);
  await upsertOrder(mapOrder(detail));

  // Clear gain if order status is no longer revenue-generating
  const REVENUE_STATUSES = new Set(['paid', 'confirmed', 'partially_paid']);
  if (!REVENUE_STATUSES.has(detail.status)) {
    await clearOrderGain(orderId);
  }

  const claimStatus = await getOrderClaimStatus(orderId);
  await updateOrderClaimStatus(orderId, claimStatus);
  if (claimStatus !== null) {
    // Claim found: clear any stored gain since the order is disputed
    await clearOrderGain(orderId);
  }

  if (detail.tags?.includes("paid") || detail.status === "paid") {
    await syncShipmentsForOrder(orderId);
  }

  broadcast("order:updated", { orderId, status: detail.status });
  console.log(`[webhook] Synced order ${orderId}, status=${detail.status}`);
}

async function syncShipment(shipmentId: number): Promise<void> {
  const shipment = await mlGet<MlShipment>(`/shipments/${shipmentId}`);
  await updateShipmentStatus(
    shipmentId,
    shipment.status,
    shipment.tracking_number ?? null
  );

  broadcast("shipment:updated", { shipmentId, orderId: shipment.order_id, status: shipment.status });
  console.log(`[webhook] Synced shipment ${shipmentId}, order=${shipment.order_id}`);
}
