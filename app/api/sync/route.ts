import { NextRequest, NextResponse } from "next/server";
import { syncShipmentsForPaidOrders } from "@/lib/ml/shipments";
import { syncUserVisits } from "@/lib/ml/visits";
import { logSyncFinish, logSyncStart } from "@/lib/db";
import { NotAuthenticatedError } from "@/lib/ml/auth";
import { MercadoLibreApiError } from "@/lib/ml/client";

/**
 * POST /api/sync
 * Triggers an immediate sync of shipments and visits.
 * Returns counts for each.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const target = url.searchParams.get("target") ?? "all";

  const results: Record<string, number | string> = {};

  if (target === "all" || target === "shipments") {
    let logId: number | null = null;
    try {
      logId = await logSyncStart("api.sync.shipments");
    } catch {
      // Logging is best-effort; don't fail the sync if it breaks
    }
    try {
      results.shipments = await syncShipmentsForPaidOrders(50);
      if (logId !== null) {
        await logSyncFinish(logId, "success", results.shipments as number).catch(() => {});
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[sync] shipments error:", err);
      if (err instanceof NotAuthenticatedError) {
        if (logId !== null) await logSyncFinish(logId, "error", 0, message).catch(() => {});
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      results.shipments_error = message;
      if (logId !== null) await logSyncFinish(logId, "error", 0, message).catch(() => {});
    }
  }

  if (target === "all" || target === "visits") {
    let logId: number | null = null;
    try {
      logId = await logSyncStart("api.sync.visits");
    } catch {
      // Logging is best-effort; don't fail the sync if it breaks
    }
    try {
      results.visits = await syncUserVisits(30);
      if (logId !== null) {
        await logSyncFinish(logId, "success", results.visits as number).catch(() => {});
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[sync] visits error:", err);
      if (err instanceof NotAuthenticatedError) {
        if (logId !== null) await logSyncFinish(logId, "error", 0, message).catch(() => {});
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      results.visits_error = message;
      if (logId !== null) await logSyncFinish(logId, "error", 0, message).catch(() => {});
    }
  }

  return NextResponse.json({ success: true, ...results });
}