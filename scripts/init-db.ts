/**
 * Standalone script to verify Supabase connection.
 * Run with: npm run init-db
 */

import { getSupabase } from "../lib/supabase";

console.log("Checking Supabase connection...\n");

async function main() {
  const supabase = getSupabase();

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
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
    if (error) {
      console.error(`  ❌ ${table}: ${error.message}`);
    } else {
      console.log(`  ✅ ${table}: ${count ?? 0} rows`);
    }
  }

  console.log("\nDatabase connection verified!");
}

main().catch((err) => {
  console.error("Failed to connect:", err);
  process.exit(1);
});