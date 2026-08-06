import { NextRequest, NextResponse } from "next/server";
import { getShipmentsToDispatch } from "@/lib/db/queries";
import { NotAuthenticatedError } from "@/lib/ml/auth";

/**
 * GET /api/shipments?limit=20&offset=0
 * Returns paginated shipments pending dispatch, joined with their order data.
 * Sorted by order's date_created DESC (most recent first) — see queries.ts.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const offsetParam = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const limit = Math.min(Math.max(limitParam, 1), 500);
    const offset = Math.max(offsetParam, 0);

    const all = await getShipmentsToDispatch();
    const items = all.slice(offset, offset + limit);
    const hasMore = offset + limit < all.length;

    return NextResponse.json({
      shipments: items,
      total: all.length,
      limit,
      offset,
      has_more: hasMore,
    });
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}