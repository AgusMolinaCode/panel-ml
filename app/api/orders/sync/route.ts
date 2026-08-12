import { NextRequest, NextResponse } from "next/server";
import { syncRecentOrders } from "@/lib/ml/orders";
import { runSyncClaims } from "@/worker/sync-claims";
import { NotAuthenticatedError } from "@/lib/ml/auth";
import { MercadoLibreApiError } from "@/lib/ml/client";
import { logSyncFinish, logSyncStart } from "@/lib/db";
import { broadcast } from "@/lib/sse/emitter";

/**
 * POST /api/orders/sync?days=1&syncShipments=false
 * Triggers an immediate sync of recent orders from MercadoLibre.
 * Returns the number of orders processed.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  const days = daysParam ? Math.min(parseInt(daysParam, 10) || 1, 90) : 1;
  const syncShipments = url.searchParams.get("syncShipments") === "true";
  const syncClaims = url.searchParams.get("syncClaims") === "true";

  let logId: number | null = null;
  try {
    logId = await logSyncStart("api.orders.sync");
  } catch {
    // Logging is best-effort
  }

  try {
    // Abort after 25s — Vercel timeout is 30s, we give ourselves a buffer
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 25_000);

    const processed = await Promise.race([
      syncRecentOrders(days, 50, syncShipments, syncClaims),
      new Promise<never>((_, reject) =>
        req.signal.addEventListener("abort", () => reject(new Error("Request aborted")))
      ),
    ]).finally(() => clearTimeout(timeout));

    if (logId !== null) await logSyncFinish(logId, "success", processed).catch(() => {});

    // Refresh claims after orders unless the caller already requested inline claim sync.
    if (!syncClaims) {
      await runSyncClaims();
    }

    // Broadcast so all connected frontends refresh immediately
    broadcast("order:updated", { source: "sync-api" });

    return NextResponse.json({ success: true, processed });
  } catch (err) {
    const message =
      err instanceof NotAuthenticatedError
        ? err.message
        : err instanceof MercadoLibreApiError
        ? `${err.message} — ${JSON.stringify(err.body)}`
        : err instanceof Error
        ? err.message
        : "Unknown error during sync";
    console.error("[orders/sync] error:", err);
    if (logId !== null) await logSyncFinish(logId, "error", 0, message).catch(() => {});

    if (err instanceof Error && err.message === "Request aborted") {
      return NextResponse.json({ error: "Request timeout" }, { status: 408 });
    }
    const httpStatus = err instanceof NotAuthenticatedError ? 401 : 500;
    return NextResponse.json({ error: message }, { status: httpStatus });
  }
}