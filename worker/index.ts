/**
 * Panel ML — background worker
 *
 * Run with: npm run worker
 *
 * Responsibilities:
 *  - Periodically check token expiry and refresh if needed
 *  - Periodically sync recent orders from MercadoLibre
 *
 * The worker is intentionally tiny. State lives in SQLite (data/ml.db),
 * shared with the Next.js dev server.
 */

import { loadEnvConfig } from "@next/env";

// Load .env.local (and friends) into process.env BEFORE importing app code
loadEnvConfig(process.cwd());

(async () => {
  const { config } = await import("../lib/config");
  const { registerJob, startAll, stopAll } = await import("./scheduler");
  const { runRefreshCheck } = await import("./refresh-check");
  const { runSyncOrders } = await import("./sync-orders");
  const { runSyncShipments } = await import("./sync-shipments");
  const { runSyncVisits } = await import("./sync-visits");
  const { runSyncClaims } = await import("./sync-claims");

  console.log("========================================");
  console.log(" Panel ML — Worker");
  console.log("========================================");
  console.log(` DB:        ${config.paths.db}`);
  console.log(` Sync every: 10 min (shipments cada 4 h)`);
  console.log("");

  registerJob({
    name: "refresh-check",
    intervalMs: 10 * 60 * 1000,
    run: runRefreshCheck,
  });

  registerJob({
    name: "sync-orders",
    intervalMs: 10 * 60 * 1000,
    run: async () => runSyncOrders(90),
  });

  registerJob({
    name: "sync-shipments",
    intervalMs: 4 * 60 * 60 * 1000,
    run: async () => runSyncShipments(100),
  });

  registerJob({
    name: "sync-visits",
    intervalMs: 10 * 60 * 1000,
    run: async () => runSyncVisits(30),
  });

  registerJob({
    name: "sync-claims",
    intervalMs: 10 * 60 * 1000,
    run: runSyncClaims,
  });

  startAll();

  function shutdown(signal: string): void {
    console.log(`\n[worker] received ${signal}, shutting down...`);
    stopAll();
    setTimeout(() => process.exit(0), 500);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
})();
