import { getDb } from "./index";
import type { Order, OrderItem, OrderPayment, OrderShipping } from "./types";

/**
 * Order statistics query layer.
 * All read-only; safe to call from server components and API routes.
 */

export interface OrderStats {
  total: number;
  totalRevenue: number; // sum of paid/confirmed/partially_paid total_amount
  currency: string;
  byStatus: Array<{ status: string; count: number; revenue: number }>;
  byDay: Array<{ day: string; count: number; revenue: number }>;
  avgDispatchTimeMs: number | null;
  topBuyers: Array<{ buyer_id: number; buyer_nickname: string | null; count: number; total: number }>;
  /** Sum of ALL orders in range (including pending, cancelled, etc.) */
  grossSales: number;
  /** Breakdown of the gross sales into categories */
  grossBreakdown: {
    processed: { count: number; revenue: number };      // paid+confirmed+partially_paid+delivered
    pending: { count: number; revenue: number };        // payment_required+payment_in_process
    pendingCancel: { count: number; revenue: number };  // pending_cancel (cancelación solicitada, espera reembolso)
    cancelled: { count: number; revenue: number };     // cancelled+invalid
  };
}

interface DateRange {
  fromMs: number;
  toMs: number;
}

const statusRevenueStatuses = ['paid', 'confirmed', 'partially_paid'] as const;

function statusIsRevenue(status: string): boolean {
  return (statusRevenueStatuses as readonly string[]).includes(status);
}

export function getOrderStats(range: DateRange): OrderStats {
  const db = getDb();
  const { fromMs, toMs } = range;

  // Headline numbers
  const total = (
    db
      .prepare("SELECT COUNT(*) as c FROM orders WHERE date_created BETWEEN ? AND ?")
      .get(fromMs, toMs) as { c: number }
  ).c;

  const revenueRow = db
    .prepare(
      `SELECT COALESCE(SUM(total_amount), 0) as revenue, currency_id
         FROM orders
        WHERE date_created BETWEEN ? AND ?
          AND status IN ('paid', 'confirmed', 'partially_paid')
        GROUP BY currency_id
        ORDER BY revenue DESC
        LIMIT 1`
    )
    .get(fromMs, toMs) as { revenue: number; currency_id: string } | undefined;

  const totalRevenue = revenueRow?.revenue ?? 0;
  const currency = revenueRow?.currency_id ?? "ARS";

  // By status
  const byStatus = db
    .prepare(
      `SELECT status,
              COUNT(*) as count,
              COALESCE(SUM(total_amount), 0) as revenue
         FROM orders
        WHERE date_created BETWEEN ? AND ?
        GROUP BY status
        ORDER BY count DESC`
    )
    .all(fromMs, toMs) as Array<{ status: string; count: number; revenue: number }>;

  // By day (date in ART, UTC-3)
  const byDay = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', date_created / 1000, 'unixepoch', '-180 minutes') as day,
              COUNT(*) as count,
              COALESCE(SUM(CASE WHEN status IN ('paid','confirmed','partially_paid') THEN total_amount ELSE 0 END), 0) as revenue
         FROM orders
        WHERE date_created BETWEEN ? AND ?
        GROUP BY day
        ORDER BY day ASC`
    )
    .all(fromMs, toMs) as Array<{ day: string; count: number; revenue: number }>;

  // Avg dispatch time (only for orders with date_closed set)
  const dispatchRow = db
    .prepare(
      `SELECT AVG(date_closed - date_created) as avg_ms
         FROM orders
        WHERE date_created BETWEEN ? AND ?
          AND date_closed IS NOT NULL
          AND status IN ('paid','confirmed','partially_paid')`
    )
    .get(fromMs, toMs) as { avg_ms: number | null };

  // Top buyers
  const topBuyers = db
    .prepare(
      `SELECT buyer_id,
              buyer_nickname,
              COUNT(*) as count,
              SUM(total_amount) as total
         FROM orders
        WHERE date_created BETWEEN ? AND ?
          AND buyer_id IS NOT NULL
        GROUP BY buyer_id
        ORDER BY total DESC
        LIMIT 10`
    )
    .all(fromMs, toMs) as Array<{
    buyer_id: number;
    buyer_nickname: string | null;
    count: number;
    total: number;
  }>;

  // Gross sales breakdown
  const processedRow = db
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue
         FROM orders
        WHERE date_created BETWEEN ? AND ?
          AND status IN ('paid', 'confirmed', 'partially_paid', 'delivered')`
    )
    .get(fromMs, toMs) as { count: number; revenue: number };

  const pendingRow = db
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue
         FROM orders
        WHERE date_created BETWEEN ? AND ?
          AND status IN ('payment_required', 'payment_in_process')`
    )
    .get(fromMs, toMs) as { count: number; revenue: number };

  const pendingCancelRow = db
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue
         FROM orders
        WHERE date_created BETWEEN ? AND ?
          AND status = 'pending_cancel'`
    )
    .get(fromMs, toMs) as { count: number; revenue: number };

  const cancelledRow = db
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue
         FROM orders
        WHERE date_created BETWEEN ? AND ?
          AND status IN ('cancelled', 'invalid')`
    )
    .get(fromMs, toMs) as { count: number; revenue: number };

  const grossSales =
    processedRow.revenue + pendingRow.revenue + pendingCancelRow.revenue + cancelledRow.revenue;

  return {
    total,
    totalRevenue,
    currency,
    byStatus,
    byDay,
    avgDispatchTimeMs: dispatchRow.avg_ms,
    topBuyers,
    grossSales,
    grossBreakdown: {
      processed: processedRow,
      pending: pendingRow,
      pendingCancel: pendingCancelRow,
      cancelled: cancelledRow,
    },
  };
}

export interface OrdersQueryOptions {
  fromMs?: number;
  toMs?: number;
  statuses?: string[];
  search?: string; // matches order id (numeric) or buyer nickname
  limit?: number;
  offset?: number;
  sortBy?: "date_created" | "total_amount" | "status" | "id";
  sortDir?: "asc" | "desc";
}

export interface OrdersResult {
  orders: Order[];
  total: number;
  limit: number;
  offset: number;
}

export function queryOrders(opts: OrdersQueryOptions = {}): OrdersResult {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.fromMs !== undefined) {
    conditions.push("date_created >= ?");
    params.push(opts.fromMs);
  }
  if (opts.toMs !== undefined) {
    conditions.push("date_created <= ?");
    params.push(opts.toMs);
  }
  if (opts.statuses && opts.statuses.length > 0) {
    const placeholders = opts.statuses.map(() => "?").join(",");
    conditions.push(`status IN (${placeholders})`);
    params.push(...opts.statuses);
  }
  if (opts.search) {
    const s = opts.search.trim();
    if (s.length > 0) {
      // Try numeric id search
      if (/^\d+$/.test(s)) {
        conditions.push("(id = ? OR buyer_nickname LIKE ?)");
        params.push(parseInt(s, 10), `%${s}%`);
      } else {
        conditions.push("buyer_nickname LIKE ?");
        params.push(`%${s}%`);
      }
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(opts.limit ?? 50, 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const sortBy = opts.sortBy ?? "date_created";
  const sortDir = opts.sortDir === "asc" ? "ASC" : "DESC";

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM orders ${where}`).get(...params) as { c: number }
  ).c;

  interface RawOrderRow {
    id: number;
    status: string;
    status_detail: string | null;
    date_created: number;
    date_closed: number | null;
    last_updated: number | null;
    total_amount: number;
    currency_id: string;
    buyer_id: number | null;
    buyer_nickname: string | null;
    items_json: string;
    payments_json: string | null;
    shipping_json: string | null;
    raw_json: string;
    synced_at: number;
  }

  const rows = db
    .prepare(
      `SELECT * FROM orders ${where} ORDER BY ${sortBy} ${sortDir} LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as RawOrderRow[];

  const orders: Order[] = rows.map((row) => ({
    id: row.id,
    status: row.status,
    status_detail: row.status_detail ?? undefined,
    date_created: row.date_created,
    date_closed: row.date_closed,
    last_updated: row.last_updated ?? undefined,
    total_amount: row.total_amount,
    currency_id: row.currency_id,
    buyer_id: row.buyer_id ?? undefined,
    buyer_nickname: row.buyer_nickname ?? undefined,
    items: JSON.parse(row.items_json) as OrderItem[],
    payments: row.payments_json ? (JSON.parse(row.payments_json) as OrderPayment[]) : [],
    shipping: row.shipping_json ? (JSON.parse(row.shipping_json) as OrderShipping) : null,
    tags: (row as unknown as { tags_json: string }).tags_json
      ? (JSON.parse((row as unknown as { tags_json: string }).tags_json) as string[])
      : [],
    listing_type_id: (row as unknown as { listing_type_id: string | null }).listing_type_id ?? null,
    sale_fee: (row as unknown as { sale_fee: number | null }).sale_fee ?? null,
    claim_status: (row as unknown as { claim_status: "opened" | "closed" | null }).claim_status ?? null,
    synced_at: row.synced_at,
  }));

  return { orders, total, limit, offset };
}

// ---------- Shipments queries ----------

import type { Shipment } from "./types";

export interface ShipmentWithOrder extends Shipment {
  buyer_nickname: string | null;
  buyer_id: number | null;
  total_amount: number;
  currency_id: string;
  date_order_created: number;
  items_summary: string;
  /** Tags from the order (paid, not_delivered, delivered, etc.) */
  tags: string[];
  /** Listing type id (gold_special=Premium, gold_pro=Clásica, free, etc.) */
  listing_type_id: string | null;
}

/** Shipments that need to be dispatched (or are overdue), joined with order data.
 /** Shipments that need to be dispatched, joined with order data.
 *  Strict filter: orders must have BOTH tags 'paid' AND 'not_delivered',
 *  and must NOT have 'delivered', 'not_paid', 'fraud_risk_detected', or 'cancelled'.
 *  Sorted by order's date_created DESC (most recent first).
 */
export function getShipmentsToDispatch(): ShipmentWithOrder[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         s.*,
         o.buyer_nickname,
         o.buyer_id,
         o.total_amount,
         o.currency_id,
         o.date_created as date_order_created,
         o.items_json,
         o.tags_json,
         o.listing_type_id
       FROM shipments s
       JOIN orders o ON o.id = s.order_id
       WHERE o.tags_json LIKE '%"paid"%'
         AND o.tags_json LIKE '%"not_delivered"%'
         AND o.tags_json NOT LIKE '%"delivered"%'
         AND o.tags_json NOT LIKE '%"not_paid"%'
         AND o.tags_json NOT LIKE '%"fraud_risk_detected"%'
         AND o.tags_json NOT LIKE '%"cancelled"%'
         AND s.status NOT IN ('cancelled', 'closed', 'not_delivered')
       ORDER BY o.date_created DESC`
    )
    .all() as Array<Shipment & {
      buyer_nickname: string | null;
      buyer_id: number | null;
      total_amount: number;
      currency_id: string;
      date_order_created: number;
      items_json: string;
      tags_json: string;
      listing_type_id: string | null;
    }>;

  return rows.map((row) => {
    const items: OrderItem[] = JSON.parse(row.items_json);
    return {
      id: row.id,
      order_id: row.order_id,
      status: row.status,
      substatus: row.substatus,
      logistic_type: row.logistic_type,
      mode: row.mode,
      tracking_number: row.tracking_number,
      tracking_method: row.tracking_method,
      carrier: row.carrier,
      cost: row.cost,
      cost_currency: row.cost_currency,
      receiver_address: (row as Shipment).receiver_address ?? null,
      shipping_items: (row as Shipment).shipping_items ?? null,
      shipping_option: (row as Shipment).shipping_option ?? null,
      handling_limit: row.handling_limit,
      date_created: row.date_created,
      date_first_printed: row.date_first_printed,
      date_delivered: row.date_delivered,
      synced_at: row.synced_at,
      buyer_nickname: row.buyer_nickname,
      buyer_id: row.buyer_id,
      total_amount: row.total_amount,
      currency_id: row.currency_id,
      date_order_created: row.date_order_created,
      items_summary: items.map((i) => `${i.quantity}× ${i.title}`).join(", "),
      tags: row.tags_json ? (JSON.parse(row.tags_json) as string[]) : [],
      listing_type_id: row.listing_type_id ?? null,
    };
  });
}

// ---------- Visits queries ----------

export interface VisitDay {
  date: string;
  total: number;
}

export interface VisitSummary {
  totalLast30: number;
  dailyAvg: number;
  bestDay: VisitDay | null;
  worstDay: VisitDay | null;
  days: VisitDay[];
}

export function getUserVisitSummary(days = 30): VisitSummary {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT date, total FROM item_visits
        WHERE item_id = '__user__'
        ORDER BY date DESC
        LIMIT ?`
    )
    .all(days) as VisitDay[];

  // Reverse so the chart can read left-to-right
  const chronological = [...rows].reverse();
  const total = chronological.reduce((sum, d) => sum + d.total, 0);
  const dailyAvg = chronological.length > 0 ? total / chronological.length : 0;
  const sorted = [...chronological].sort((a, b) => b.total - a.total);
  const bestDay = sorted[0] && sorted[0].total > 0 ? sorted[0] : null;
  const worstDay =
    sorted[sorted.length - 1] && sorted[sorted.length - 1].total > 0
      ? sorted[sorted.length - 1]
      : null;

  return {
    totalLast30: total,
    dailyAvg,
    bestDay,
    worstDay,
    days: chronological,
  };
}

// ---------- Intent (payment_required / payment_in_process) ----------

export interface IntentOrder {
  id: number;
  status: string;
  date_created: number;
  total_amount: number;
  currency_id: string;
  buyer_nickname: string | null;
  buyer_id: number | null;
  items_summary: string;
}

export function getIntentOrders(): IntentOrder[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, status, date_created, total_amount, currency_id,
              buyer_nickname, buyer_id, items_json
         FROM orders
        WHERE status IN ('payment_required', 'payment_in_process')
        ORDER BY date_created DESC
        LIMIT 50`
    )
    .all() as Array<{
    id: number;
    status: string;
    date_created: number;
    total_amount: number;
    currency_id: string;
    buyer_nickname: string | null;
    buyer_id: number | null;
    items_json: string;
  }>;

  return rows.map((r) => {
    const items: OrderItem[] = JSON.parse(r.items_json);
    return {
      id: r.id,
      status: r.status,
      date_created: r.date_created,
      total_amount: r.total_amount,
      currency_id: r.currency_id,
      buyer_nickname: r.buyer_nickname,
      buyer_id: r.buyer_id,
      items_summary: items.map((i) => `${i.quantity}× ${i.title}`).join(", "),
    };
  });
}

export interface MonthlyGain {
  month: string;
  orderCount: number;
  totalSales: number;
  totalCosts: number;
  totalGain: number;
}

const USD_PER_KG = 15;
const DEFAULT_DOLLAR_RATE = 1600;
const ENVIO_FIJO = 7000;

export function getMonthlyGains(fromMs: number, toMs: number): MonthlyGain[] {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT
         strftime('%Y-%m', o.date_created / 1000, 'unixepoch', '-180 minutes') as month,
         o.id as order_id,
         o.total_amount,
         o.sale_fee,
         o.status,
         oc.cost,
         oc.logistic_mode,
         oc.weight_kg,
         oc.ml_fee_pct,
         oc.gain as stored_gain,
         oc.ml_envio
       FROM orders o
       INNER JOIN order_costs oc ON o.id = oc.order_id
       WHERE o.date_created BETWEEN ? AND ?
         AND o.status IN ('paid', 'confirmed', 'partially_paid', 'delivered')
       ORDER BY month DESC`
    )
    .all(fromMs, toMs) as Array<{
      month: string;
      order_id: number;
      total_amount: number;
      sale_fee: number | null;
      status: string;
      cost: number | null;
      weight_kg: number | null;
      ml_fee_pct: number | null;
      stored_gain: number | null;
      ml_envio: number | null;
    }>;

  const monthMap = new Map<string, MonthlyGain>();

  for (const row of rows) {
    if (!monthMap.has(row.month)) {
      monthMap.set(row.month, {
        month: row.month,
        orderCount: 0,
        totalSales: 0,
        totalCosts: 0,
        totalGain: 0,
      });
    }

    if (row.stored_gain == null && row.cost == null) continue;

    const m = monthMap.get(row.month)!;
    const netSalePrice = row.total_amount / 1.21;
    const mlFeeAmount = row.sale_fee ?? row.total_amount * ((row.ml_fee_pct ?? 15) / 100);
    const percepcion1 = row.total_amount * 0.01;
    const percepcion3 = mlFeeAmount * 0.03;
    const iibb = netSalePrice * 0.18;
    const mlEnvio = row.ml_envio ?? ENVIO_FIJO;
    const cuotasCost = row.total_amount * 0.06;
    const courierARS = (row.weight_kg ?? 0) * USD_PER_KG * DEFAULT_DOLLAR_RATE;

    const orderGain = row.stored_gain != null
      ? row.stored_gain
      : netSalePrice - percepcion1 - percepcion3 - iibb - mlFeeAmount - mlEnvio - cuotasCost - courierARS - row.cost!;

    m.orderCount++;
    m.totalSales += row.total_amount;
    m.totalCosts += row.cost ?? 0;
    m.totalGain += orderGain;
  }

  return Array.from(monthMap.values()).sort((a, b) => b.month.localeCompare(a.month));
}