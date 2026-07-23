/**
 * Standalone script to initialize the SQLite database.
 * Run with: npm run init-db
 *
 * This is mostly for clarity — the DB is also auto-created on first connection
 * via lib/db/index.ts. Use this script if you want to verify schema or
 * initialize before starting any worker.
 */

import { getDb } from "../lib/db/index";

console.log("Initializing SQLite database...");

try {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;

  console.log("Tables created:");
  for (const { name } of tables) {
    const count = (db.prepare(`SELECT COUNT(*) as c FROM ${name}`).get() as { c: number }).c;
    console.log(`  - ${name} (${count} rows)`);
  }
  console.log("\nDatabase ready at data/ml.db");
} catch (err) {
  console.error("Failed to initialize database:", err);
  process.exit(1);
}