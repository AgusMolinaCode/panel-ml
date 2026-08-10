import { NextRequest, NextResponse } from "next/server";
import { syncRecentOrders } from "@/lib/ml/orders";
import { NotAuthenticatedError } from "@/lib/ml/auth";
import { MercadoLibreApiError } from "@/lib/ml/client";
import { logSyncFinish, logSyncStart } from "@/lib/db";

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

  let logId: number | null = null;
  try {
    logId = await logSyncStart("api.orders.sync");
  } catch {
    // Logging is best-effort
  }

  try {
    const processed = await syncRecentOrders(days, 50, syncShipments);
    if (logId !== null) await logSyncFinish(logId, "success", processed).catch(() => {});
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

    const httpStatus = err instanceof NotAuthenticatedError ? 401 : 500;
    return NextResponse.json({ error: message }, { status: httpStatus });
  }
}