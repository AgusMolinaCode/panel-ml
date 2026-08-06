import { NextResponse } from "next/server";
import { getRecentSyncLogs } from "@/lib/db";

/**
 * GET /api/sync-logs?limit=20
 * Returns the most recent sync log entries.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 20, 100) : 20;

  const logs = await getRecentSyncLogs(limit);
  return NextResponse.json({ logs });
}