import { NextRequest, NextResponse } from "next/server";
import { syncRecentOrders } from "@/lib/ml/orders";
import { NotAuthenticatedError } from "@/lib/ml/auth";
import { MercadoLibreApiError } from "@/lib/ml/client";
import { logSyncFinish, logSyncStart } from "@/lib/db";

/**
 * POST /api/orders/sync?limit=50
 * Triggers an immediate sync of recent orders from MercadoLibre.
 * Returns the number of orders processed.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 200) : 50;

  const logId = logSyncStart("api.orders.sync");
  try {
    const processed = await syncRecentOrders(limit);
    logSyncFinish(logId, "success", processed);
    return NextResponse.json({ success: true, processed });
  } catch (err) {
    const status = "error";
    const message =
      err instanceof NotAuthenticatedError
        ? err.message
        : err instanceof MercadoLibreApiError
        ? `${err.message} — ${JSON.stringify(err.body)}`
        : err instanceof Error
        ? err.message
        : "Unknown error during sync";
    logSyncFinish(logId, status, 0, message);

    const httpStatus = err instanceof NotAuthenticatedError ? 401 : 500;
    return NextResponse.json({ error: message }, { status: httpStatus });
  }
}