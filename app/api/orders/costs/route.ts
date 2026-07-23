import { NextRequest, NextResponse } from "next/server";
import { getOrderCostsBulk } from "@/lib/db";
import { NotAuthenticatedError } from "@/lib/ml/auth";

/**
 * GET /api/orders/costs?ids=1,2,3,4
 * Returns a map of { orderId: costData } for the given order IDs.
 * Single round-trip instead of N individual requests.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const idsParam = new URL(req.url).searchParams.get("ids");
    if (!idsParam) {
      return NextResponse.json({ error: "Missing ids param" }, { status: 400 });
    }
    const ids = idsParam.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
    if (ids.length === 0) {
      return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
    }
    const map = getOrderCostsBulk(ids);
    const result: Record<number, object | null> = {};
    for (const [id, cost] of map) {
      result[id] = cost;
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
