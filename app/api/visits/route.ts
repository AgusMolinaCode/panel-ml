import { NextRequest, NextResponse } from "next/server";
import { getUserVisitSummary } from "@/lib/db/queries";
import { NotAuthenticatedError } from "@/lib/ml/auth";

/**
 * GET /api/visits?days=30
 * Returns the seller's daily visit count for the last `days` days.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const daysParam = parseInt(url.searchParams.get("days") ?? "30", 10);
    const days = Math.min(Math.max(daysParam, 1), 150);

    const summary = await getUserVisitSummary(days);
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}