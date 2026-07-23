import { NextResponse } from "next/server";
import { getIntentOrders } from "@/lib/db/queries";
import { NotAuthenticatedError } from "@/lib/ml/auth";

/**
 * GET /api/orders/intent
 * Returns orders in payment_required / payment_in_process status.
 * This is the closest proxy to "intention to buy" that MercadoLibre exposes —
 * the buyer created the order but hasn't completed payment yet.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const rows = getIntentOrders();
    const totalAmount = rows.reduce((sum, r) => sum + r.total_amount, 0);
    return NextResponse.json({
      orders: rows,
      count: rows.length,
      total_amount: totalAmount,
      currency: rows[0]?.currency_id ?? "ARS",
    });
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}