-- MercadoLibre credentials (single row, id=1 enforced)
CREATE TABLE IF NOT EXISTS ml_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id INTEGER NOT NULL,
  nickname TEXT,
  email TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  scope TEXT,
  token_type TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Orders synced from MercadoLibre
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,
  status_detail TEXT,
  date_created INTEGER NOT NULL,
  date_closed INTEGER,
  last_updated INTEGER,
  total_amount REAL NOT NULL,
  currency_id TEXT NOT NULL DEFAULT 'ARS',
  buyer_id INTEGER,
  buyer_nickname TEXT,
  items_json TEXT NOT NULL DEFAULT '[]',
  payments_json TEXT,
  shipping_json TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  listing_type_id TEXT,
  claim_status TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  synced_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_orders_date_created ON orders(date_created DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);

-- Sync log for the worker
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  records_processed INTEGER DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_log_started_at ON sync_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_job ON sync_log(job_name, started_at DESC);

-- Shipments (1:1 with paid orders that have MercadoEnvíos)
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  substatus TEXT,
  logistic_type TEXT,
  mode TEXT,
  tracking_number TEXT,
  tracking_method TEXT,
  carrier TEXT,
  cost REAL,
  cost_currency TEXT,
  receiver_address_json TEXT,
  shipping_items_json TEXT,
  shipping_option_json TEXT,
  handling_limit INTEGER,
  date_created INTEGER,
  date_first_printed INTEGER,
  date_delivered INTEGER,
  raw_json TEXT NOT NULL DEFAULT '{}',
  synced_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_handling_limit ON shipments(handling_limit);

-- Item visits (daily total per item)
CREATE TABLE IF NOT EXISTS item_visits (
  item_id TEXT NOT NULL,
  date TEXT NOT NULL,
  total INTEGER NOT NULL,
  synced_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (item_id, date)
);

CREATE INDEX IF NOT EXISTS idx_item_visits_date ON item_visits(date DESC);
CREATE INDEX IF NOT EXISTS idx_item_visits_item ON item_visits(item_id, date DESC);

-- Order costs (manually entered by the seller)
CREATE TABLE IF NOT EXISTS order_costs (
  order_id INTEGER PRIMARY KEY,
  cost REAL NOT NULL DEFAULT 0,
  ml_fee_pct REAL NOT NULL DEFAULT 15,
  notes TEXT,
  logistic_mode TEXT NOT NULL DEFAULT 'iva',
  weight_kg REAL,
  gain REAL,
  ml_envio REAL,
  ml_neto REAL,
  iibb REAL,
  row_color TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);