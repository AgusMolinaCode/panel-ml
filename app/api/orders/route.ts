import { NextRequest, NextResponse } from "next/server";
import { queryOrders, type OrdersQueryOptions } from "@/lib/db/queries";
import { getOrderCostsBulk } from "@/lib/db";
import { NotAuthenticatedError } from "@/lib/ml/auth";

/**
 * GET /api/orders?from=ms&to=ms&status=paid,confirmed&search=&limit=&offset=&sort=&dir=
 * Returns paginated, filtered, sorted orders from the local SQLite.
 * Also returns costsMap for the returned orders in a single round-trip.
 *
 * GET /api/orders?latest=true&from=ms&to=ms
 * Returns only { latestOrderId, count } — fast check for new orders.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const from = parseInt(url.searchParams.get("from") ?? "", 10);
    const to = parseInt(url.searchParams.get("to") ?? "", 10);
    const statusParam = url.searchParams.get("status");
    const search = url.searchParams.get("search") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const sortBy = (url.searchParams.get("sort") as OrdersQueryOptions["sortBy"]) ?? "date_created";
    const sortDir = (url.searchParams.get("dir") as OrdersQueryOptions["sortDir"]) ?? "desc";

    const opts: OrdersQueryOptions = { limit, offset, sortBy, sortDir };
    if (!Number.isNaN(from) && from > 0) opts.fromMs = from;
    if (!Number.isNaN(to) && to > 0) opts.toMs = to;
    if (statusParam) opts.statuses = statusParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (search) opts.search = search;

    if (url.searchParams.get("latest") === "true") {
      const result = await queryOrders({ ...opts, limit: 1 });
      return NextResponse.json({
        latestOrderId: result.orders[0]?.id ?? null,
        total: result.total,
      });
    }

    const result = await queryOrders(opts);

    const costsMap: Record<number, object | null> = {};
    if (result.orders.length > 0) {
      const costs = await getOrderCostsBulk(result.orders.map((o) => o.id));
      for (const [id, cost] of costs) {
        costsMap[id] = cost;
      }
    }

    return NextResponse.json({ ...result, costs: costsMap });
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}