import { NextRequest, NextResponse } from "next/server";
import { getOrderStats } from "@/lib/db/queries";
import { NotAuthenticatedError } from "@/lib/ml/auth";

/**
 * GET /api/orders/stats?from=ms&to=ms
 * Returns aggregated KPIs for the given range (defaults to last 30 days).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const fromParam = parseInt(url.searchParams.get("from") ?? "", 10);
    const toParam = parseInt(url.searchParams.get("to") ?? "", 10);

    const toMs = !Number.isNaN(toParam) && toParam > 0 ? toParam : Date.now();
    const fromMs =
      !Number.isNaN(fromParam) && fromParam > 0
        ? fromParam
        : toMs - 30 * 24 * 60 * 60 * 1000;

    const stats = await getOrderStats({ fromMs, toMs });
    return NextResponse.json({ range: { from: fromMs, to: toMs }, ...stats });
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}