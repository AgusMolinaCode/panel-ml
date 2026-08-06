import { NextRequest, NextResponse } from "next/server";
import { deleteOrderCost, getOrderCost, upsertOrderCost } from "@/lib/db";
import { NotAuthenticatedError } from "@/lib/ml/auth";
import { DEFAULT_ML_FEE_PCT } from "@/lib/pricing";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/orders/[id]/cost → returns the cost entry for an order, or null.
 */
export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (Number.isNaN(orderId)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }
    const cost = getOrderCost(orderId);
    return NextResponse.json({ cost });
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/orders/[id]/cost → upsert cost for an order.
 * Body: { cost: number, ml_fee_pct?: number, notes?: string }
 */
export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (Number.isNaN(orderId)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    let body: { cost?: number; ml_fee_pct?: number; notes?: string; logistic_mode?: "iva" | "kilos"; weight_kg?: number | null; gain?: number | null; ml_envio?: number | null; ml_neto?: number | null; iibb?: number | null; row_color?: string | null; manual_cost_input?: string | null; manual_cost_currency?: string | null; dollar_rate?: number | null };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const cost = Number(body.cost ?? 0);
    const mlFeePct = Number(body.ml_fee_pct ?? DEFAULT_ML_FEE_PCT);
    const notes = body.notes?.trim() || null;
    const logisticMode = body.logistic_mode === "kilos" ? "kilos" : "iva";
    const weightKg = body.weight_kg != null ? Number(body.weight_kg) : null;
    const gain = body.gain != null ? Number(body.gain) : null;
    const mlEnvio = body.ml_envio != null ? Number(body.ml_envio) : null;
    const mlNeto = body.ml_neto != null ? Number(body.ml_neto) : null;
    const iibb = body.iibb != null ? Number(body.iibb) : null;
    const rowColor = body.row_color ?? null;
    const manualCostInput = body.manual_cost_input ?? null;
    const manualCostCurrency = body.manual_cost_currency ?? null;
    const dollarRate = body.dollar_rate != null ? Number(body.dollar_rate) : null;

    if (Number.isNaN(cost) || cost < 0) {
      return NextResponse.json({ error: "Invalid cost" }, { status: 400 });
    }
    if (Number.isNaN(mlFeePct) || mlFeePct < 0 || mlFeePct > 100) {
      return NextResponse.json({ error: "Invalid ml_fee_pct" }, { status: 400 });
    }
    if (weightKg !== null && (Number.isNaN(weightKg) || weightKg < 0)) {
      return NextResponse.json({ error: "Invalid weight_kg" }, { status: 400 });
    }
    if (gain !== null && Number.isNaN(gain)) {
      return NextResponse.json({ error: "Invalid gain" }, { status: 400 });
    }
    if (mlEnvio !== null && (Number.isNaN(mlEnvio) || mlEnvio < 0)) {
      return NextResponse.json({ error: "Invalid ml_envio" }, { status: 400 });
    }
    if (dollarRate !== null && (Number.isNaN(dollarRate) || dollarRate <= 0)) {
      return NextResponse.json({ error: "Invalid dollar_rate" }, { status: 400 });
    }

    upsertOrderCost(orderId, cost, mlFeePct, notes, logisticMode, weightKg, gain, mlEnvio, mlNeto, iibb, rowColor, manualCostInput, manualCostCurrency, dollarRate);
    return NextResponse.json({
      success: true,
      cost: { order_id: orderId, cost, ml_fee_pct: mlFeePct, notes, logistic_mode: logisticMode, weight_kg: weightKg, gain, ml_envio: mlEnvio, ml_neto: mlNeto, iibb, row_color: rowColor, manual_cost_input: manualCostInput, manual_cost_currency: manualCostCurrency, dollar_rate: dollarRate, updated_at: Date.now() },
    });
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/orders/[id]/cost → removes the cost entry for an order.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (Number.isNaN(orderId)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }
    deleteOrderCost(orderId);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}