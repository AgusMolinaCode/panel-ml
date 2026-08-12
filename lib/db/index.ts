import { getSupabase } from '../supabase'
import type { MlCredentials, Order, OrderItem, OrderPayment, OrderShipping, SyncLogEntry } from './types'

// ---------- Credentials ----------

export async function getCredentials(): Promise<MlCredentials | null> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('ml_credentials')
    .select('*')
    .eq('id', 1)
    .single()
  return data as MlCredentials | null
}

export async function saveCredentials(creds: Omit<MlCredentials, 'id' | 'updated_at'>): Promise<void> {
  const supabase = getSupabase()
  await supabase.from('ml_credentials').upsert({
    id: 1,
    ...creds,
    updated_at: Date.now()
  })
}

export async function clearCredentials(): Promise<void> {
  const supabase = getSupabase()
  await supabase.from('ml_credentials').delete().eq('id', 1)
}

// ---------- Orders ----------

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
  tags_json: string
  listing_type_id: string | null
  sale_fee: number | null
  claim_status: string | null
  raw_json: string
  synced_at: number
}

function rowToOrder(row: RawOrderRow): Order {
  return {
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
  }
}

export async function upsertOrder(
  order: Omit<Order, 'synced_at' | 'claim_status'> & { claim_status?: 'opened' | 'closed' | null | undefined }
): Promise<void> {
  const supabase = getSupabase()
  const upsertData: Record<string, unknown> = {
    id: order.id,
    status: order.status,
    status_detail: order.status_detail ?? null,
    date_created: order.date_created,
    date_closed: order.date_closed ?? null,
    last_updated: order.last_updated ?? null,
    total_amount: order.total_amount,
    currency_id: order.currency_id,
    buyer_id: order.buyer_id ?? null,
    buyer_nickname: order.buyer_nickname ?? null,
    items_json: JSON.stringify(order.items),
    payments_json: order.payments.length > 0 ? JSON.stringify(order.payments) : null,
    shipping_json: order.shipping ? JSON.stringify(order.shipping) : null,
    tags_json: JSON.stringify(order.tags ?? []),
    listing_type_id: order.listing_type_id ?? null,
    sale_fee: order.sale_fee ?? null,
    raw_json: JSON.stringify(order),
    synced_at: Date.now(),
  }
  // Only touch claim_status when explicitly provided. This prevents order syncs
  // from wiping a claim status that was set by the dedicated claims sync.
  if (order.claim_status !== undefined) {
    upsertData.claim_status = order.claim_status
  }
  await supabase.from('orders').upsert(upsertData as Omit<Order, 'synced_at'>, {
    onConflict: 'id'
  })
}

export async function getRecentOrders(limit = 50): Promise<Order[]> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('orders')
    .select('*')
    .order('date_created', { ascending: false })
    .limit(limit)
  return (data as RawOrderRow[] || []).map(rowToOrder)
}

export async function getLatestOrderDate(): Promise<number | null> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('orders')
    .select('date_created')
    .order('date_created', { ascending: false })
    .limit(1)
    .single()
  return data?.date_created ?? null
}

export async function getOrderById(id: number): Promise<Order | null> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .single()
  return data ? rowToOrder(data as RawOrderRow) : null
}

export async function updateOrderClaimStatus(orderId: number, claimStatus: 'opened' | 'closed' | null): Promise<void> {
  const supabase = getSupabase()
  await supabase
    .from('orders')
    .update({ claim_status: claimStatus })
    .eq('id', orderId)
}

// ---------- Sync log ----------

export async function logSyncStart(jobName: string): Promise<number | null> {
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('sync_log')
      .insert({
        job_name: jobName,
        started_at: Date.now(),
        status: 'running'
      })
      .select('id')
      .single()
    return data?.id ?? null
  } catch {
    // If logging fails (RLS, permissions, etc.), return null and continue
    return null
  }
}

export async function logSyncFinish(
  id: number | null,
  status: 'success' | 'error' | 'partial',
  recordsProcessed = 0,
  errorMessage: string | null = null
): Promise<void> {
  if (id === null) return
  try {
    const supabase = getSupabase()
    await supabase
      .from('sync_log')
      .update({
        finished_at: Date.now(),
        status,
        records_processed: recordsProcessed,
        error_message: errorMessage
      })
      .eq('id', id)
  } catch {
    // Best-effort logging
  }
}

export async function getRecentSyncLogs(limit = 20): Promise<SyncLogEntry[]> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('sync_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)
  return (data as SyncLogEntry[]) || []
}

// ---------- Order Costs ----------

export async function getOrderCost(orderId: number): Promise<import('./types').OrderCost | null> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('order_costs')
    .select('*')
    .eq('order_id', orderId)
    .single()
  return data as import('./types').OrderCost | null
}

export async function getOrderCostsBulk(orderIds: number[]): Promise<Map<number, import('./types').OrderCost>> {
  if (orderIds.length === 0) return new Map()
  const supabase = getSupabase()
  const { data } = await supabase
    .from('order_costs')
    .select('*')
    .in('order_id', orderIds)
  const result = new Map<number, import('./types').OrderCost>()
  if (data) {
    for (const row of data as import('./types').OrderCost[]) {
      result.set(row.order_id, row)
    }
  }
  return result
}

export async function upsertOrderCost(
  orderId: number,
  cost: number,
  mlFeePct: number,
  notes: string | null,
  logisticMode: 'iva' | 'kilos' = 'iva',
  weightKg: number | null = null,
  gain: number | null = null,
  mlEnvio: number | null = null,
  mlNeto: number | null = null,
  iibb: number | null = null,
  rowColor: string | null = null,
  manualCostInput: string | null = null,
  manualCostCurrency: string | null = null,
  dollarRate: number | null = null
): Promise<void> {
  const supabase = getSupabase()
  await supabase.from('order_costs').upsert({
    order_id: orderId,
    cost,
    ml_fee_pct: mlFeePct,
    notes,
    logistic_mode: logisticMode,
    weight_kg: weightKg,
    gain,
    ml_envio: mlEnvio,
    ml_neto: mlNeto,
    iibb,
    row_color: rowColor,
    manual_cost_input: manualCostInput,
    manual_cost_currency: manualCostCurrency,
    dollar_rate: dollarRate,
    updated_at: Date.now()
  }, {
    onConflict: 'order_id'
  })
}

export async function deleteOrderCost(orderId: number): Promise<void> {
  const supabase = getSupabase()
  await supabase.from('order_costs').delete().eq('order_id', orderId)
}

/** Clear the stored gain for an order (set gain=null) without deleting the cost record.
 *  Called when a claim is opened/closed or when order status becomes non-revenue. */
export async function clearOrderGain(orderId: number): Promise<void> {
  const supabase = getSupabase()
  await supabase
    .from('order_costs')
    .update({ gain: null, updated_at: Date.now() })
    .eq('order_id', orderId)
    .not('gain', 'is', null) // only update if there's actually a gain to clear
}

/** Clear gains for all orders that have an open or closed claim.
 *  Returns the number of orders cleared. */
export async function clearGainsForOrdersWithClaims(): Promise<number> {
  const supabase = getSupabase()

  // Get orders with claims that also have a stored gain
  const { data } = await supabase
    .from('orders')
    .select('id')
    .not('claim_status', 'is', null)

  if (!data || data.length === 0) return 0

  const claimOrderIds = data.map((o) => o.id)

  const { data: updated } = await supabase
    .from('order_costs')
    .update({ gain: null, updated_at: Date.now() })
    .in('order_id', claimOrderIds)
    .not('gain', 'is', null)
    .select('order_id')

  return updated?.length ?? 0
}

// ---------- Monthly Expenses ----------

export async function getMonthlyExpenses(month: string): Promise<import('./types').MonthlyExpense[]> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('monthly_expenses')
    .select('*')
    .eq('month', month)
    .order('created_at', { ascending: true })
  return (data as import('./types').MonthlyExpense[]) || []
}

export async function upsertMonthlyExpense(expense: import('./types').MonthlyExpense): Promise<void> {
  const supabase = getSupabase()
  await supabase.from('monthly_expenses').upsert(expense, {
    onConflict: 'id'
  })
}

export async function deleteMonthlyExpense(id: string): Promise<void> {
  const supabase = getSupabase()
  await supabase.from('monthly_expenses').delete().eq('id', id)
}

// ---------- Repair Orders ----------

export async function getMonthlyRepairs(month: string): Promise<import('./types').RepairOrder[]> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('repairs')
    .select('*')
    .eq('month', month)
    .order('date', { ascending: false })
  return (data as import('./types').RepairOrder[]) || []
}

export async function upsertRepair(repair: import('./types').RepairOrder): Promise<void> {
  const supabase = getSupabase()
  await supabase.from('repairs').upsert(repair, {
    onConflict: 'id'
  })
}

export async function deleteRepair(id: string): Promise<void> {
  const supabase = getSupabase()
  await supabase.from('repairs').delete().eq('id', id)
}

// ---------- Shipments ----------

interface RawShipmentRow {
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
  raw_json: string
  synced_at: number
}

function rowToShipment(row: RawShipmentRow): import('./types').Shipment {
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
    receiver_address: row.receiver_address_json ? JSON.parse(row.receiver_address_json) : null,
    shipping_items: row.shipping_items_json ? JSON.parse(row.shipping_items_json) : null,
    shipping_option: row.shipping_option_json ? JSON.parse(row.shipping_option_json) : null,
    handling_limit: row.handling_limit,
    date_created: row.date_created,
    date_first_printed: row.date_first_printed,
    date_delivered: row.date_delivered,
    synced_at: row.synced_at,
  }
}

export async function upsertShipment(s: Omit<import('./types').Shipment, 'synced_at'>): Promise<void> {
  const supabase = getSupabase()
  await supabase.from('shipments').upsert({
    id: s.id,
    order_id: s.order_id,
    status: s.status,
    substatus: s.substatus,
    logistic_type: s.logistic_type,
    mode: s.mode,
    tracking_number: s.tracking_number,
    tracking_method: s.tracking_method,
    carrier: s.carrier,
    cost: s.cost,
    cost_currency: s.cost_currency,
    receiver_address_json: s.receiver_address ? JSON.stringify(s.receiver_address) : null,
    shipping_items_json: s.shipping_items ? JSON.stringify(s.shipping_items) : null,
    shipping_option_json: s.shipping_option ? JSON.stringify(s.shipping_option) : null,
    handling_limit: s.handling_limit,
    date_created: s.date_created,
    date_first_printed: s.date_first_printed,
    date_delivered: s.date_delivered,
    raw_json: JSON.stringify(s),
    synced_at: Date.now(),
  }, {
    onConflict: 'id'
  })
}

export async function getShipmentById(id: number): Promise<import('./types').Shipment | null> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', id)
    .single()
  return data ? rowToShipment(data as RawShipmentRow) : null
}

export async function getShipmentsBulk(orderIds: number[]): Promise<Map<number, { status: string; tracking_number: string | null } | null>> {
  const result = new Map<number, { status: string; tracking_number: string | null } | null>()
  if (orderIds.length === 0) return result
  const supabase = getSupabase()
  const { data } = await supabase
    .from('shipments')
    .select('order_id, status, tracking_number')
    .in('order_id', orderIds)
  for (const id of orderIds) {
    result.set(id, null)
  }
  if (data) {
    for (const row of data as Array<{ order_id: number; status: string; tracking_number: string | null }>) {
      result.set(row.order_id, { status: row.status, tracking_number: row.tracking_number })
    }
  }
  return result
}

export async function updateShipmentStatus(id: number, status: string, trackingNumber: string | null): Promise<void> {
  const supabase = getSupabase()
  await supabase
    .from('shipments')
    .update({ status, tracking_number: trackingNumber, synced_at: Date.now() })
    .eq('id', id)
}

// ---------- Visits ----------

export async function upsertItemVisit(itemId: string, date: string, total: number): Promise<void> {
  const supabase = getSupabase()
  await supabase.from('item_visits').upsert({
    item_id: itemId,
    date,
    total,
    synced_at: Date.now()
  }, {
    onConflict: 'item_id,date'
  })
}

export async function upsertUserVisits(visits: Array<{ date: string; total: number }>): Promise<number> {
  const supabase = getSupabase()
  const inserts = visits.map(v => ({
    item_id: '__user__',
    date: v.date,
    total: v.total,
    synced_at: Date.now()
  }))
  await supabase.from('item_visits').upsert(inserts, {
    onConflict: 'item_id,date'
  })
  return visits.length
}
