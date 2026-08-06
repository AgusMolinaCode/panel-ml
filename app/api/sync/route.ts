import { NextRequest, NextResponse } from "next/server";
import { syncShipmentsForPaidOrders } from "@/lib/ml/shipments";
import { syncUserVisits } from "@/lib/ml/visits";
import { logSyncFinish, logSyncStart } from "@/lib/db";
import { NotAuthenticatedError } from "@/lib/ml/auth";
import { MercadoLibreApiError } from "@/lib/ml/client";

/**
 * POST /api/sync/shipments
 * Triggers an immediate sync of shipments and visits.
 * Returns counts for each.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const target = url.searchParams.get("target") ?? "all";

  const results: Record<string, number | string> = {};

  if (target === "all" || target === "shipments") {
    const logId = await logSyncStart("api.sync.shipments");
    try {
      results.shipments = await syncShipmentsForPaidOrders(50);
      await logSyncFinish(logId, "success", results.shipments as number);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await logSyncFinish(logId, "error", 0, message);
      if (err instanceof NotAuthenticatedError) {
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      results.shipments_error = message;
    }
  }

  if (target === "all" || target === "visits") {
    const logId = await logSyncStart("api.sync.visits");
    try {
      results.visits = await syncUserVisits(30);
      await logSyncFinish(logId, "success", results.visits as number);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await logSyncFinish(logId, "error", 0, message);
      if (err instanceof NotAuthenticatedError) {
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      results.visits_error = message;
    }
  }

  return NextResponse.json({ success: true, ...results });
}