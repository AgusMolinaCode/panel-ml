/**
 * Migration script: SQLite → Supabase
 *
 * Usage: npx tsx scripts/migrate-to-supabase.ts
 *
 * Requires environment variables:
 *   SUPABASE_URL=https://sbjszsterwdttqsujgfc.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const DATA_DIR = join(process.cwd(), "data/export");

async function apiFetch(endpoint: string, options: RequestInit) {
  const url = `${SUPABASE_URL}${endpoint}`;
  const res = await globalThis.fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${url} → ${res.status} ${res.statusText}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function insertTable(table: string, rows: unknown[]) {
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows, skipping`);
    return;
  }
  // Supabase bulk insert - split into chunks of 1000
  const chunkSize = 1000;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const res = await apiFetch(`/rest/v1/${table}`, {
      method: "POST",
      body: JSON.stringify(chunk),
      headers: { Prefer: "resolution=merge-duplicates" },
    });
    console.log(`  ${table}: ${i + chunk.length}/${rows.length} rows`);
  }
}

async function migrate() {
  console.log("Starting migration to Supabase...\n");

  const tables = [
    "ml_credentials",
    "orders",
    "shipments",
    "order_costs",
    "monthly_expenses",
    "item_visits",
    "sync_log",
  ];

  for (const table of tables) {
    const filePath = join(DATA_DIR, `${table}.json`);
    const raw = readFileSync(filePath, "utf-8");
    const rows = JSON.parse(raw);
    console.log(`Inserting ${table}...`);
    await insertTable(table, rows);
  }

  console.log("\n✅ Migration complete!");
}

migrate().catch((err) => {
  console.error("\n❌ Migration failed:", err.message);
  process.exit(1);
});
