import { NextRequest, NextResponse } from "next/server";
import { getMonthlyGains } from "@/lib/db/queries";

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

    const gains = getMonthlyGains(fromMs, toMs);
    return NextResponse.json(gains);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
