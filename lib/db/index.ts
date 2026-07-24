import Database from "better-sqlite3";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { MlCredentials, Order, OrderItem, OrderPayment, OrderShipping, SyncLogEntry } from "./types";

/**
 * SQLite connection singleton.
 * Uses better-sqlite3 (synchronous API, ideal for local single-process apps).
 *
 * In Next.js dev mode, hot reload can create multiple instances — we stash on globalThis
 * to reuse the connection across reloads and avoid "database is locked" errors.
 */

const GLOBAL_KEY = "__panel_ml_db__";

interface GlobalWithDb {
  [GLOBAL_KEY]?: Database.Database;
}

function getGlobalDb(): Database.Database | undefined {
  return (globalThis as unknown as GlobalWithDb)[GLOBAL_KEY];
}

function setGlobalDb(db: Database.Database): void {
  (globalThis as unknown as GlobalWithDb)[GLOBAL_KEY] = db;
}

function resolveDbPath(): string {
  const fromEnv = process.env.DB_PATH;
  if (fromEnv && fromEnv.trim() !== "") {
    return resolve(process.cwd(), fromEnv);
  }
  return resolve(process.cwd(), "data/ml.db");
}

function runMigrations(db: Database.Database): void {
  const schemaPath = join(process.cwd(), "lib/db/schema.sql");
  if (!existsSync(schemaPath)) {
    throw new Error(`Schema file not found at ${schemaPath}`);
  }
  const schema = readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  // Forward-only ALTER TABLE migrations for columns added after the initial
  // schema. SQLite's CREATE TABLE IF NOT EXISTS does NOT add new columns to
  // an existing table, so we have to ALTER them explicitly.
  const ordersColumns = db.prepare("PRAGMA table_info(orders)").all() as Array<{ name: string }>;
  const has = (col: string) => ordersColumns.some((c) => c.name === col);
  if (!has("tags_json")) {
    db.exec("ALTER TABLE orders ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!has("listing_type_id")) {
    db.exec("ALTER TABLE orders ADD COLUMN listing_type_id TEXT");
  }
  if (!has("sale_fee")) {
    db.exec("ALTER TABLE orders ADD COLUMN sale_fee REAL");
  }
  if (!has("claim_status")) {
    db.exec("ALTER TABLE orders ADD COLUMN claim_status TEXT");
  }

  const costColumns = db.prepare("PRAGMA table_info(order_costs)").all() as Array<{ name: string }>;
  const hasCost = (col: string) => costColumns.some((c) => c.name === col);
  if (!hasCost("logistic_mode")) {
    db.exec("ALTER TABLE order_costs ADD COLUMN logistic_mode TEXT NOT NULL DEFAULT 'iva'");
  }
  if (!hasCost("weight_kg")) {
    db.exec("ALTER TABLE order_costs ADD COLUMN weight_kg REAL");
  }
  if (!hasCost("gain")) {
    db.exec("ALTER TABLE order_costs ADD COLUMN gain REAL");
  }
  if (!hasCost("ml_envio")) {
    db.exec("ALTER TABLE order_costs ADD COLUMN ml_envio REAL");
  }
  if (!hasCost("ml_neto")) {
    db.exec("ALTER TABLE order_costs ADD COLUMN ml_neto REAL");
  }
  if (!hasCost("iibb")) {
    db.exec("ALTER TABLE order_costs ADD COLUMN iibb REAL");
  }
  if (!hasCost("row_color")) {
    db.exec("ALTER TABLE order_costs ADD COLUMN row_color TEXT");
  }
  if (!hasCost("manual_cost_input")) {
    db.exec("ALTER TABLE order_costs ADD COLUMN manual_cost_input TEXT");
  }
  if (!hasCost("manual_cost_currency")) {
    db.exec("ALTER TABLE order_costs ADD COLUMN manual_cost_currency TEXT");
  }
}

export function getDb(): Database.Database {
  const existing = getGlobalDb();
  if (existing) return existing;

  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  runMigrations(db);

  setGlobalDb(db);
  return db;
}

// ---------- Credentials ----------

export function getCredentials(): MlCredentials | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM ml_credentials WHERE id = 1").get() as MlCredentials | undefined;
  return row ?? null;
}

export function saveCredentials(creds: Omit<MlCredentials, "id" | "updated_at">): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO ml_credentials (
      id, user_id, nickname, email, access_token, refresh_token,
      expires_at, scope, token_type, updated_at
    ) VALUES (
      1, @user_id, @nickname, @email, @access_token, @refresh_token,
      @expires_at, @scope, @token_type, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      nickname = excluded.nickname,
      email = excluded.email,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      token_type = excluded.token_type,
      updated_at = excluded.updated_at
  `);
  stmt.run({ ...creds, updated_at: Date.now() });
}

export function clearCredentials(): void {
  const db = getDb();
  db.prepare("DELETE FROM ml_credentials WHERE id = 1").run();
}

// ---------- Orders ----------

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
  tags_json: string;
  listing_type_id: string | null;
  sale_fee: number | null;
  claim_status: string | null;
  raw_json: string;
  synced_at: number;
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
    claim_status: (row.claim_status as "opened" | "closed" | null) ?? null,
    synced_at: row.synced_at,
  };
}

export function upsertOrder(order: Omit<Order, "synced_at">): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO orders (
      id, status, status_detail, date_created, date_closed, last_updated,
      total_amount, currency_id, buyer_id, buyer_nickname,
      items_json, payments_json, shipping_json, tags_json, listing_type_id,
      sale_fee, claim_status, raw_json, synced_at
    ) VALUES (
      @id, @status, @status_detail, @date_created, @date_closed, @last_updated,
      @total_amount, @currency_id, @buyer_id, @buyer_nickname,
      @items_json, @payments_json, @shipping_json, @tags_json, @listing_type_id,
      @sale_fee, @claim_status, @raw_json, @synced_at
    )
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      status_detail = excluded.status_detail,
      date_closed = excluded.date_closed,
      last_updated = excluded.last_updated,
      total_amount = excluded.total_amount,
      currency_id = excluded.currency_id,
      buyer_id = excluded.buyer_id,
      buyer_nickname = excluded.buyer_nickname,
      items_json = excluded.items_json,
      payments_json = excluded.payments_json,
      shipping_json = excluded.shipping_json,
      tags_json = excluded.tags_json,
      listing_type_id = excluded.listing_type_id,
      sale_fee = excluded.sale_fee,
      claim_status = excluded.claim_status,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at
  `);
  stmt.run({
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
    claim_status: order.claim_status ?? null,
    raw_json: JSON.stringify(order),
    synced_at: Date.now(),
  });
}

export function getRecentOrders(limit = 50): Order[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM orders ORDER BY date_created DESC LIMIT ?")
    .all(limit) as RawOrderRow[];
  return rows.map(rowToOrder);
}

export function getLatestOrderDate(): number | null {
  const db = getDb();
  const row = db
    .prepare("SELECT MAX(date_created) as max_date FROM orders")
    .get() as { max_date: number | null } | undefined;
  return row?.max_date ?? null;
}

export function getOrderById(id: number): Order | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as RawOrderRow | undefined;
  return row ? rowToOrder(row) : null;
}

export function updateOrderClaimStatus(orderId: number, claimStatus: "opened" | "closed" | null): void {
  const db = getDb();
  db.prepare("UPDATE orders SET claim_status = ? WHERE id = ?").run(claimStatus, orderId);
}

// ---------- Sync log ----------

export function logSyncStart(jobName: string): number {
  const db = getDb();
  const result = db
    .prepare("INSERT INTO sync_log (job_name, started_at, status) VALUES (?, ?, 'running')")
    .run(jobName, Date.now());
  return Number(result.lastInsertRowid);
}

export function logSyncFinish(
  id: number,
  status: "success" | "error" | "partial",
  recordsProcessed = 0,
  errorMessage: string | null = null
): void {
  const db = getDb();
  db.prepare(
    "UPDATE sync_log SET finished_at = ?, status = ?, records_processed = ?, error_message = ? WHERE id = ?"
  ).run(Date.now(), status, recordsProcessed, errorMessage, id);
}

export function getRecentSyncLogs(limit = 20): SyncLogEntry[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ?")
    .all(limit) as SyncLogEntry[];
}

// ---------- Order Costs ----------

export function getOrderCost(orderId: number): import("./types").OrderCost | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM order_costs WHERE order_id = ?")
    .get(orderId) as import("./types").OrderCost | undefined;
  return row ?? null;
}

export function getOrderCostsBulk(orderIds: number[]): Map<number, import("./types").OrderCost> {
  if (orderIds.length === 0) return new Map();
  const db = getDb();
  const placeholders = orderIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM order_costs WHERE order_id IN (${placeholders})`)
    .all(...orderIds) as import("./types").OrderCost[];
  return new Map(rows.map((r) => [r.order_id, r]));
}

export function upsertOrderCost(
  orderId: number,
  cost: number,
  mlFeePct: number,
  notes: string | null,
  logisticMode: "iva" | "kilos" = "iva",
  weightKg: number | null = null,
  gain: number | null = null,
  mlEnvio: number | null = null,
  mlNeto: number | null = null,
  iibb: number | null = null,
  rowColor: string | null = null,
  manualCostInput: string | null = null,
  manualCostCurrency: string | null = null
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO order_costs (order_id, cost, ml_fee_pct, notes, logistic_mode, weight_kg, gain, ml_envio, ml_neto, iibb, row_color, manual_cost_input, manual_cost_currency, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(order_id) DO UPDATE SET
       cost = excluded.cost,
       ml_fee_pct = excluded.ml_fee_pct,
       notes = excluded.notes,
       logistic_mode = excluded.logistic_mode,
       weight_kg = excluded.weight_kg,
       gain = excluded.gain,
       ml_envio = excluded.ml_envio,
       ml_neto = excluded.ml_neto,
       iibb = excluded.iibb,
       row_color = excluded.row_color,
       manual_cost_input = excluded.manual_cost_input,
       manual_cost_currency = excluded.manual_cost_currency,
       updated_at = excluded.updated_at`
  ).run(orderId, cost, mlFeePct, notes, logisticMode, weightKg, gain, mlEnvio, mlNeto, iibb, rowColor, manualCostInput, manualCostCurrency, Date.now());
}

export function deleteOrderCost(orderId: number): void {
  const db = getDb();
  db.prepare("DELETE FROM order_costs WHERE order_id = ?").run(orderId);
}

// ---------- Shipments ----------

interface RawShipmentRow {
  id: number;
  order_id: number;
  status: string;
  substatus: string | null;
  logistic_type: string | null;
  mode: string | null;
  tracking_number: string | null;
  tracking_method: string | null;
  carrier: string | null;
  cost: number | null;
  cost_currency: string | null;
  receiver_address_json: string | null;
  shipping_items_json: string | null;
  shipping_option_json: string | null;
  handling_limit: number | null;
  date_created: number | null;
  date_first_printed: number | null;
  date_delivered: number | null;
  raw_json: string;
  synced_at: number;
}

function rowToShipment(row: RawShipmentRow): import("./types").Shipment {
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
  };
}

export function upsertShipment(s: Omit<import("./types").Shipment, "synced_at">): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO shipments (
      id, order_id, status, substatus, logistic_type, mode,
      tracking_number, tracking_method, carrier,
      cost, cost_currency,
      receiver_address_json, shipping_items_json, shipping_option_json,
      handling_limit, date_created, date_first_printed, date_delivered,
      raw_json, synced_at
    ) VALUES (
      @id, @order_id, @status, @substatus, @logistic_type, @mode,
      @tracking_number, @tracking_method, @carrier,
      @cost, @cost_currency,
      @receiver_address_json, @shipping_items_json, @shipping_option_json,
      @handling_limit, @date_created, @date_first_printed, @date_delivered,
      @raw_json, @synced_at
    )
    ON CONFLICT(id) DO UPDATE SET
      order_id = excluded.order_id,
      status = excluded.status,
      substatus = excluded.substatus,
      logistic_type = excluded.logistic_type,
      mode = excluded.mode,
      tracking_number = excluded.tracking_number,
      tracking_method = excluded.tracking_method,
      carrier = excluded.carrier,
      cost = excluded.cost,
      cost_currency = excluded.cost_currency,
      receiver_address_json = excluded.receiver_address_json,
      shipping_items_json = excluded.shipping_items_json,
      shipping_option_json = excluded.shipping_option_json,
      handling_limit = excluded.handling_limit,
      date_created = excluded.date_created,
      date_first_printed = excluded.date_first_printed,
      date_delivered = excluded.date_delivered,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at`
  ).run({
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
  });
}

export function getShipmentById(id: number): import("./types").Shipment | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM shipments WHERE id = ?").get(id) as RawShipmentRow | undefined;
  return row ? rowToShipment(row) : null;
}

export function getShipmentsBulk(orderIds: number[]): Map<number, { status: string; tracking_number: string | null } | null> {
  const db = getDb();
  const result = new Map<number, { status: string; tracking_number: string | null } | null>();
  if (orderIds.length === 0) return result;
  const placeholders = orderIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT order_id, status, tracking_number FROM shipments WHERE order_id IN (${placeholders})`
  ).all(...orderIds) as Array<{ order_id: number; status: string; tracking_number: string | null }>;
  for (const id of orderIds) {
    result.set(id, null);
  }
  for (const row of rows) {
    result.set(row.order_id, { status: row.status, tracking_number: row.tracking_number });
  }
  return result;
}

// ---------- Visits ----------

export function upsertItemVisit(itemId: string, date: string, total: number): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO item_visits (item_id, date, total, synced_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(item_id, date) DO UPDATE SET
       total = excluded.total,
       synced_at = excluded.synced_at`
  ).run(itemId, date, total, Date.now());
}

export function upsertUserVisits(visits: Array<{ date: string; total: number }>): number {
  // For the user-level aggregate, we store the user as a single pseudo-item.
  // The item_id "__user__" is the convention.
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO item_visits (item_id, date, total, synced_at)
     VALUES ('__user__', ?, ?, ?)
     ON CONFLICT(item_id, date) DO UPDATE SET
       total = excluded.total,
       synced_at = excluded.synced_at`
  );
  const tx = db.transaction((rows: typeof visits) => {
    for (const r of rows) stmt.run(r.date, r.total, Date.now());
  });
  tx(visits);
  return visits.length;
}

// ---------- Sync log ----------