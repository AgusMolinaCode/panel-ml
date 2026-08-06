import { getSupabase } from '../supabase'
import type { Order, OrderItem, OrderPayment, OrderShipping, Shipment } from './types'
import { gainForOrder } from '../pricing'

/**
 * Order statistics query layer.
 * All read-only; safe to call from server components and API routes.
 */

export interface OrderStats {
  total: number
  totalRevenue: number // sum of paid/confirmed/partially_paid total_amount
  currency: string
  byStatus: Array<{ status: string; count: number; revenue: number }>
  byDay: Array<{ day: string; count: number; revenue: number }>
  avgDispatchTimeMs: number | null
  topBuyers: Array<{ buyer_id: number; buyer_nickname: string | null; count: number; total: number }>
  /** Sum of ALL orders in range (including pending, cancelled, etc.) */
  grossSales: number
  /** Breakdown of the gross sales into categories */
  grossBreakdown: {
    processed: { count: number; revenue: number }      // paid+confirmed+partially_paid+delivered
    pending: { count: number; revenue: number }        // payment_required+payment_in_process
    pendingCancel: { count: number; revenue: number };  // pending_cancel (cancelación solicitada, espera reembolso)
    cancelled: { count: number; revenue: number };   // cancelled+invalid
  };
}

interface DateRange {
  fromMs: number
  toMs: number
}

const statusRevenueStatuses = ['paid', 'confirmed', 'partially_paid'] as const

function statusIsRevenue(status: string): boolean {
  return (statusRevenueStatuses as readonly string[]).includes(status)
}

export async function getOrderStats(range: DateRange): Promise<OrderStats> {
  const supabase = getSupabase()
  const { fromMs, toMs } = range

  // Headline numbers - total count
  const { data: totalData } = await supabase
    .from('orders')
    .select('id')
    .gte('date_created', fromMs)
    .lte('date_created', toMs)
  const total = totalData?.length ?? 0

  // Revenue row
  const { data: revenueData } = await supabase
    .from('orders')
    .select('total_amount, currency_id')
    .gte('date_created', fromMs)
    .lte('date_created', toMs)
    .in('status', ['paid', 'confirmed', 'partially_paid'])

  let totalRevenue = 0
  let currency = 'ARS'
  if (revenueData && revenueData.length > 0) {
    const currencyMap = new Map<string, number>()
    for (const row of revenueData as Array<{ total_amount: number; currency_id: string }>) {
      const current = currencyMap.get(row.currency_id) ?? 0
      currencyMap.set(row.currency_id, current + row.total_amount)
    }
    const sorted = Array.from(currencyMap.entries()).sort((a, b) => b[1] - a[1])
    if (sorted.length > 0) {
      currency = sorted[0][0]
      totalRevenue = sorted[0][1]
    }
  }

  // By status
  const { data: statusData } = await supabase
    .from('orders')
    .select('status, total_amount')
    .gte('date_created', fromMs)
    .lte('date_created', toMs)

  const byStatusMap = new Map<string, { count: number; revenue: number }>()
  if (statusData) {
    for (const row of statusData as Array<{ status: string; total_amount: number }>) {
      const current = byStatusMap.get(row.status) ?? { count: 0, revenue: 0 }
      byStatusMap.set(row.status, {
        count: current.count + 1,
        revenue: current.revenue + row.total_amount
      })
    }
  }
  const byStatus = Array.from(byStatusMap.entries())
    .map(([status, data]) => ({ status, ...data }))
    .sort((a, b) => b.count - a.count)

  // By day (date in ART, UTC-3) - using raw SQL with to_char for date formatting
  const { data: dayData } = await supabase
    .from('orders')
    .select('date_created, status, total_amount')
    .gte('date_created', fromMs)
    .lte('date_created', toMs)

  const byDayMap = new Map<string, { count: number; revenue: number }>()
  if (dayData) {
    for (const row of dayData as Array<{ date_created: number; status: string; total_amount: number }>) {
      const date = new Date(row.date_created)
      date.setHours(date.getHours() - 3) // ART is UTC-3
      const day = date.toISOString().split('T')[0]
      const current = byDayMap.get(day) ?? { count: 0, revenue: 0 }
      byDayMap.set(day, {
        count: current.count + 1,
        revenue: current.revenue + (statusIsRevenue(row.status) ? row.total_amount : 0)
      })
    }
  }
  const byDay = Array.from(byDayMap.entries())
    .map(([day, data]) => ({ day, ...data }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // Avg dispatch time (only for orders with date_closed set)
  const { data: dispatchData } = await supabase
    .from('orders')
    .select('date_created, date_closed, status')
    .gte('date_created', fromMs)
    .lte('date_created', toMs)
    .not('date_closed', 'is', null)
    .in('status', ['paid', 'confirmed', 'partially_paid'])

  let avgDispatchTimeMs: number | null = null
  if (dispatchData && dispatchData.length > 0) {
    let totalDispatch = 0
    let count = 0
    for (const row of dispatchData as Array<{ date_created: number; date_closed: number | null; status: string }>) {
      if (row.date_closed) {
        totalDispatch += row.date_closed - row.date_created
        count++
      }
    }
    avgDispatchTimeMs = count > 0 ? totalDispatch / count : null
  }

  // Top buyers
  const { data: buyersData } = await supabase
    .from('orders')
    .select('buyer_id, buyer_nickname, total_amount')
    .gte('date_created', fromMs)
    .lte('date_created', toMs)
    .not('buyer_id', 'is', null)

  const buyersMap = new Map<number, { buyer_nickname: string | null; count: number; total: number }>()
  if (buyersData) {
    for (const row of buyersData as Array<{ buyer_id: number; buyer_nickname: string | null; total_amount: number }>) {
      const current = buyersMap.get(row.buyer_id) ?? { buyer_nickname: row.buyer_nickname, count: 0, total: 0 }
      buyersMap.set(row.buyer_id, {
        buyer_nickname: row.buyer_nickname,
        count: current.count + 1,
        total: current.total + row.total_amount
      })
    }
  }
  const topBuyers = Array.from(buyersMap.entries())
    .map(([buyer_id, data]) => ({ buyer_id, ...data }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  // Gross sales breakdown
  const { data: processedData } = await supabase
    .from('orders')
    .select('total_amount')
    .gte('date_created', fromMs)
    .lte('date_created', toMs)
    .in('status', ['paid', 'confirmed', 'partially_paid', 'delivered'])
  const processed = processedData ?? []
  const processedRow = {
    count: processed.length,
    revenue: (processed as Array<{ total_amount: number }>).reduce((sum, r) => sum + r.total_amount, 0)
  }

  const { data: pendingData } = await supabase
    .from('orders')
    .select('total_amount')
    .gte('date_created', fromMs)
    .lte('date_created', toMs)
    .in('status', ['payment_required', 'payment_in_process'])
  const pending = pendingData ?? []
  const pendingRow = {
    count: pending.length,
    revenue: (pending as Array<{ total_amount: number }>).reduce((sum, r) => sum + r.total_amount, 0)
  }

  const { data: pendingCancelData } = await supabase
    .from('orders')
    .select('total_amount')
    .gte('date_created', fromMs)
    .lte('date_created', toMs)
    .eq('status', 'pending_cancel')
  const pendingCancel = pendingCancelData ?? []
  const pendingCancelRow = {
    count: pendingCancel.length,
    revenue: (pendingCancel as Array<{ total_amount: number }>).reduce((sum, r) => sum + r.total_amount, 0)
  }

  const { data: cancelledData } = await supabase
    .from('orders')
    .select('total_amount')
    .gte('date_created', fromMs)
    .lte('date_created', toMs)
    .in('status', ['cancelled', 'invalid'])
  const cancelled = cancelledData ?? []
  const cancelledRow = {
    count: cancelled.length,
    revenue: (cancelled as Array<{ total_amount: number }>).reduce((sum, r) => sum + r.total_amount, 0)
  }

  const grossSales = processedRow.revenue + pendingRow.revenue + pendingCancelRow.revenue + cancelledRow.revenue

  return {
    total,
    totalRevenue,
    currency,
    byStatus,
    byDay,
    avgDispatchTimeMs,
    topBuyers,
    grossSales,
    grossBreakdown: {
      processed: processedRow,
      pending: pendingRow,
      pendingCancel: pendingCancelRow,
      cancelled: cancelledRow,
    },
  }
}

export interface OrdersQueryOptions {
  fromMs?: number
  toMs?: number
  statuses?: string[]
  search?: string // matches order id (numeric) or buyer nickname
  limit?: number
  offset?: number
  sortBy?: 'date_created' | 'total_amount' | 'status' | 'id'
  sortDir?: 'asc' | 'desc'
}

export interface OrdersResult {
  orders: Order[]
  total: number
  limit: number
  offset: number
}

export async function queryOrders(opts: OrdersQueryOptions = {}): Promise<OrdersResult> {
  const supabase = getSupabase()
  const conditions: string[] = []
  const params: unknown[] = []

  let query = supabase.from('orders').select('*', { count: 'exact' })

  if (opts.fromMs !== undefined) {
    query = query.gte('date_created', opts.fromMs)
  }
  if (opts.toMs !== undefined) {
    query = query.lte('date_created', opts.toMs)
  }
  if (opts.statuses && opts.statuses.length > 0) {
    query = query.in('status', opts.statuses)
  }
  if (opts.search) {
    const s = opts.search.trim()
    if (s.length > 0) {
      if (/^\d+$/.test(s)) {
        query = query.or(`id.eq.${parseInt(s, 10)},buyer_nickname.ilike.%${s}%`)
      } else {
        query = query.ilike('buyer_nickname', `%${s}%`)
      }
    }
  }

  const limit = Math.min(opts.limit ?? 50, 500)
  const offset = Math.max(opts.offset ?? 0, 0)
  const sortBy = opts.sortBy ?? 'date_created'
  const sortDir = opts.sortDir === 'asc' ? true : false

  query = query.order(sortBy, { ascending: sortDir }).range(offset, offset + limit - 1)

  const { data, count } = await query

  interface RawOrderRow {
    id: number
    status: string
    status_detail: string | null
    date_created: number
    date_closed: number | null
    last_updated: number | null
    total_amount: number
    currency_id: string
    buyer_id: number | null
    buyer_nickname: string | null
    items_json: string
    payments_json: string | null
    shipping_json: string | null
    raw_json: string
    synced_at: number
    tags_json: string
    listing_type_id: string | null
    sale_fee: number | null
    claim_status: string | null
  }

  const rows = (data as RawOrderRow[]) || []

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
    tags: row.tags_json ? (JSON.parse(row.tags_json) as string[]) : [],
    listing_type_id: row.listing_type_id ?? null,
    sale_fee: row.sale_fee ?? null,
    claim_status: (row.claim_status as 'opened' | 'closed' | null) ?? null,
    synced_at: row.synced_at,
  }))

  return { orders, total: count ?? 0, limit, offset }
}

// ---------- Shipments queries ----------

export interface ShipmentWithOrder extends Shipment {
  buyer_nickname: string | null
  buyer_id: number | null
  total_amount: number
  currency_id: string
  date_order_created: number
  items_summary: string
  /** Tags from the order (paid, not_delivered, delivered, etc.) */
  tags: string[]
  /** Listing type id (gold_special=Premium, gold_pro=Clásica, free, etc.) */
  listing_type_id: string | null
}

/** Shipments that need to be dispatched (or are overdue), joined with order data.
 *  Strict filter: orders must have BOTH tags 'paid' AND 'not_delivered',
 *  and must NOT have 'delivered', 'not_paid', 'fraud_risk_detected', or 'cancelled'.
 *  Sorted by order's date_created DESC (most recent first).
 */
export async function getShipmentsToDispatch(): Promise<ShipmentWithOrder[]> {
  const supabase = getSupabase()

  // Get all shipments with their orders
  const { data } = await supabase
    .from('shipments')
    .select(`
      *,
      orders:order_id (
        buyer_nickname,
        buyer_id,
        total_amount,
        currency_id,
        date_created,
        items_json,
        tags_json,
        listing_type_id
      )
    `)
    .not('status', 'in', '("cancelled","closed","not_delivered")')
    .order('date_created', { ascending: false, foreignTable: 'orders' })

  if (!data) return []

  const rows = data as Array<{
    id: number
    order_id: number
    status: string
    substatus: string | null
    logistic_type: string | null
    mode: string | null
    tracking_number: string | null
    tracking_method: string | null
    carrier: string | null
    cost: number | null
    cost_currency: string | null
    receiver_address_json: string | null
    shipping_items_json: string | null
    shipping_option_json: string | null
    handling_limit: number | null
    date_created: number | null
    date_first_printed: number | null
    date_delivered: number | null
    synced_at: number
    orders: {
      buyer_nickname: string | null
      buyer_id: number | null
      total_amount: number
      currency_id: string
      date_created: number
      items_json: string
      tags_json: string
      listing_type_id: string | null
    } | null
  }>

  const result: ShipmentWithOrder[] = []

  for (const row of rows) {
    if (!row.orders) continue
    const order = row.orders

    // Parse tags
    let tags: string[] = []
    try {
      tags = order.tags_json ? JSON.parse(order.tags_json) : []
    } catch {
      tags = []
    }

    // Filter: must have 'paid' and 'not_delivered', must NOT have 'delivered', 'not_paid', 'fraud_risk_detected', or 'cancelled'
    const hasPaid = tags.includes('paid')
    const hasNotDelivered = tags.includes('not_delivered')
    const hasDelivered = tags.includes('delivered')
    const hasNotPaid = tags.includes('not_paid')
    const hasFraudRisk = tags.includes('fraud_risk_detected')
    const hasCancelled = tags.includes('cancelled')

    if (!hasPaid || !hasNotDelivered || hasDelivered || hasNotPaid || hasFraudRisk || hasCancelled) {
      continue
    }

    // Parse items
    let items: OrderItem[] = []
    try {
      items = order.items_json ? JSON.parse(order.items_json) : []
    } catch {
      items = []
    }

    result.push({
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
      receiver_address: row.receiver_address_json ? JSON.parse(row.receiver_address_json) : null,
      shipping_items: row.shipping_items_json ? JSON.parse(row.shipping_items_json) : null,
      shipping_option: row.shipping_option_json ? JSON.parse(row.shipping_option_json) : null,
      handling_limit: row.handling_limit,
      date_created: row.date_created,
      date_first_printed: row.date_first_printed,
      date_delivered: row.date_delivered,
      synced_at: row.synced_at,
      buyer_nickname: order.buyer_nickname,
      buyer_id: order.buyer_id,
      total_amount: order.total_amount,
      currency_id: order.currency_id,
      date_order_created: order.date_created,
      items_summary: items.map((i) => `${i.quantity}× ${i.title}`).join(', '),
      tags,
      listing_type_id: order.listing_type_id ?? null,
    })
  }

  return result
}

// ---------- Visits queries ----------

export interface VisitDay {
  date: string
  total: number
}

export interface VisitSummary {
  totalLast30: number
  dailyAvg: number
  bestDay: VisitDay | null
  worstDay: VisitDay | null
  days: VisitDay[]
}

export async function getUserVisitSummary(days = 30): Promise<VisitSummary> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('item_visits')
    .select('date, total')
    .eq('item_id', '__user__')
    .order('date', { ascending: false })
    .limit(days)

  const rows = (data as VisitDay[]) || []

  // Reverse so the chart can read left-to-right
  const chronological = [...rows].reverse()
  const total = chronological.reduce((sum, d) => sum + d.total, 0)
  const dailyAvg = chronological.length > 0 ? total / chronological.length : 0
  const sorted = [...chronological].sort((a, b) => b.total - a.total)
  const bestDay = sorted[0] && sorted[0].total > 0 ? sorted[0] : null
  const worstDay =
    sorted[sorted.length - 1] && sorted[sorted.length - 1].total > 0
      ? sorted[sorted.length - 1]
      : null

  return {
    totalLast30: total,
    dailyAvg,
    bestDay,
    worstDay,
    days: chronological,
  }
}

// ---------- Intent (payment_required / payment_in_process) ----------

export interface IntentOrder {
  id: number
  status: string
  date_created: number
  total_amount: number
  currency_id: string
  buyer_nickname: string | null
  buyer_id: number | null
  items_summary: string
}

export async function getIntentOrders(): Promise<IntentOrder[]> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('orders')
    .select('id, status, date_created, total_amount, currency_id, buyer_nickname, buyer_id, items_json')
    .in('status', ['payment_required', 'payment_in_process'])
    .order('date_created', { ascending: false })
    .limit(50)

  const rows = data || []

  return rows.map((r: {
    id: number
    status: string
    date_created: number
    total_amount: number
    currency_id: string
    buyer_nickname: string | null
    buyer_id: number | null
    items_json: string
  }) => {
    const items: OrderItem[] = JSON.parse(r.items_json)
    return {
      id: r.id,
      status: r.status,
      date_created: r.date_created,
      total_amount: r.total_amount,
      currency_id: r.currency_id,
      buyer_nickname: r.buyer_nickname,
      buyer_id: r.buyer_id,
      items_summary: items.map((i) => `${i.quantity}× ${i.title}`).join(', '),
    }
  })
}

export interface MonthlyGain {
  month: string
  orderCount: number
  totalSales: number
  totalCosts: number
  totalGain: number
}

export async function getMonthlyGains(fromMs: number, toMs: number): Promise<MonthlyGain[]> {
  const supabase = getSupabase()

  const { data } = await supabase
    .from('orders')
    .select(`
      id,
      date_created,
      total_amount,
      sale_fee,
      status,
      order_costs (
        cost,
        logistic_mode,
        weight_kg,
        ml_fee_pct,
        gain as stored_gain,
        ml_envio,
        dollar_rate
      )
    `)
    .gte('date_created', fromMs)
    .lte('date_created', toMs)
    .in('status', ['paid', 'confirmed', 'partially_paid', 'delivered'])

  const rows = data as Array<{
    id: number
    date_created: number
    total_amount: number
    sale_fee: number | null
    status: string
    order_costs: {
      cost: number | null
      logistic_mode: string | null
      weight_kg: number | null
      ml_fee_pct: number | null
      stored_gain: number | null
      ml_envio: number | null
      dollar_rate: number | null
    } | null
  }> | null

  if (!rows) return []

  const monthMap = new Map<string, MonthlyGain>()

  for (const row of rows) {
    // Convert to ART date for month grouping
    const date = new Date(row.date_created)
    date.setHours(date.getHours() - 3) // ART is UTC-3
    const month = date.toISOString().substring(0, 7) // YYYY-MM format

    if (!monthMap.has(month)) {
      monthMap.set(month, {
        month,
        orderCount: 0,
        totalSales: 0,
        totalCosts: 0,
        totalGain: 0,
      })
    }

    if (!row.order_costs || (row.order_costs.cost == null && row.order_costs.stored_gain == null)) continue

    const m = monthMap.get(month)!
    const oc = row.order_costs

    // Ganancia manual prioriza. Si no: fórmula nueva desde ago-2026
    const orderGain = oc.stored_gain != null
      ? oc.stored_gain
      : gainForOrder(row.date_created, {
          totalAmount: row.total_amount,
          saleFee: row.sale_fee,
          mlFeePct: oc.ml_fee_pct,
          costARS: oc.cost ?? 0,
          mlEnvio: oc.ml_envio,
          weightKg: oc.weight_kg,
          dollarRate: oc.dollar_rate,
        })

    m.orderCount++
    m.totalSales += row.total_amount
    m.totalCosts += oc.cost ?? 0
    m.totalGain += orderGain
  }

  return Array.from(monthMap.values()).sort((a, b) => b.month.localeCompare(a.month))
}
