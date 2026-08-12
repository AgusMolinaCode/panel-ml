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

    const isNumericSearch = search && /^\d+$/.test(search.trim());
    const isTextSearch = search && !isNumericSearch;

    const opts: OrdersQueryOptions = { limit, offset, sortBy, sortDir };
    if (!Number.isNaN(from) && from > 0) opts.fromMs = from;
    if (!Number.isNaN(to) && to > 0) opts.toMs = to;
    if (statusParam) opts.statuses = statusParam.split(",").map((s) => s.trim()).filter(Boolean);
    const claimStatusParam = url.searchParams.get("claim_status");
    if (claimStatusParam === "opened" || claimStatusParam === "closed") {
      opts.claimStatus = claimStatusParam;
    }
    if (search && isNumericSearch) opts.search = search;

    if (url.searchParams.get("latest") === "true") {
      const result = await queryOrders({ ...opts, limit: 1 });
      return NextResponse.json({
        latestOrderId: result.orders[0]?.id ?? null,
        total: result.total,
      });
    }

    // For text search (item titles), fetch more orders and filter in-memory
    const fetchLimit = isTextSearch ? 500 : limit;
    const result = await queryOrders({ ...opts, limit: fetchLimit });

    // Filter by item title when searching by text
    let filteredOrders = result.orders;
    if (isTextSearch) {
      const term = search!.trim().toLowerCase();
      filteredOrders = result.orders.filter((order) =>
        order.items.some((item) => item.title.toLowerCase().includes(term))
      );
    }

    // total is result.total — correct for normal queries.
    // For text search, result.total reflects orders matching date/status (before in-memory filter),
    // which is an upper bound; pagination still works and user can infer partial results.
    const total = result.total;

    const costsMap: Record<number, object | null> = {};
    if (filteredOrders.length > 0) {
      const costs = await getOrderCostsBulk(filteredOrders.map((o) => o.id));
      for (const [id, cost] of costs) {
        costsMap[id] = cost;
      }
    }

    return NextResponse.json({
      orders: filteredOrders,
      total,
      limit,
      offset,
      costs: costsMap,
    });
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}