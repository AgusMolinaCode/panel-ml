import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const IVA_RATE = 0.21;
const IVA_FRACTION = IVA_RATE / (1 + IVA_RATE);

interface OrderWithCost {
  id: number;
  date_created: number;
  total_amount: number;
  status: string;
  sale_fee: number | null;
  cost: number | null;
  ml_envio: number | null;
  weight_kg: number | null;
  dollar_rate: number | null;
}

function getMonthRange(year: number, month: number): { fromMs: number; toMs: number } {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { fromMs: start.getTime(), toMs: end.getTime() };
}

/**
 * GET /api/billing/iva-summary?year=YYYY&month=MM
 *
 * Calcula el IVA estimado a abonar para un mes específico usando únicamente
 * los datos locales de órdenes y costos cargados en el panel.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const yearParam = parseInt(url.searchParams.get("year") ?? "", 10);
    const monthParam = parseInt(url.searchParams.get("month") ?? "", 10);

    const year = Number.isNaN(yearParam) ? new Date().getFullYear() : yearParam;
    const month = Number.isNaN(monthParam) ? new Date().getMonth() + 1 : monthParam;

    if (month < 1 || month > 12) {
      return NextResponse.json({ error: "Invalid month" }, { status: 400 });
    }

    const { fromMs, toMs } = getMonthRange(year, month);

    const db = getDb();
    const rows = db
      .prepare(
        `SELECT
           o.id,
           o.date_created,
           o.total_amount,
           o.status,
           o.sale_fee,
           oc.cost,
           oc.ml_envio,
           oc.weight_kg,
           oc.dollar_rate
         FROM orders o
         LEFT JOIN order_costs oc ON o.id = oc.order_id
         WHERE o.date_created BETWEEN ? AND ?
           AND o.status IN ('paid', 'confirmed', 'partially_paid', 'delivered')
         ORDER BY o.date_created ASC`
      )
      .all(fromMs, toMs) as OrderWithCost[];

    let ivaDebito = 0;
    let creditoImportacion = 0;
    let creditoComisionesML = 0;
    let creditoEnvioML = 0;
    let creditoCourier = 0;
    let totalSales = 0;
    let orderCount = 0;
    let ordersWithCost = 0;

    for (const order of rows) {
      const totalAmount = Number(order.total_amount) || 0;
      ivaDebito += totalAmount * IVA_FRACTION;
      totalSales += totalAmount;
      orderCount++;

      const cost = order.cost ?? 0;
      const mlEnvio = order.ml_envio ?? 0;
      const weightKg = order.weight_kg ?? 0;
      const dollarRate = order.dollar_rate ?? 0;
      const saleFee = order.sale_fee ?? 0;

      if (cost > 0 || mlEnvio > 0 || weightKg > 0 || saleFee > 0) {
        ordersWithCost++;
      }

      // Crédito fiscal: derechos de importación 21% sobre costo producto
      creditoImportacion += cost * IVA_RATE;

      // Crédito fiscal: comisión ML con IVA (sale_fee ya incluye IVA 21%)
      creditoComisionesML += saleFee * IVA_FRACTION;

      // Crédito fiscal: envío ML a cargo del vendedor (con IVA)
      creditoEnvioML += mlEnvio * IVA_FRACTION;

      // Crédito fiscal: flete/courier (USD → ARS, con IVA 21%)
      creditoCourier += weightKg * 18 * dollarRate * IVA_RATE;
    }

    const creditoFiscalTotal =
      creditoImportacion + creditoComisionesML + creditoEnvioML + creditoCourier;
    const ivaAAbonar = ivaDebito - creditoFiscalTotal;

    // Proyección al cierre del mes (lineal, basada en los días transcurridos)
    const now = new Date();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    let projection: { projectedIvaDebito: number; projectedIvaAAbonar: number; daysElapsed: number; daysInMonth: number } | null = null;

    if (isCurrentMonth && orderCount > 0) {
      const daysInMonth = new Date(year, month, 0).getDate();
      const daysElapsed = Math.min(Math.max(now.getDate(), 1), daysInMonth);
      const factor = daysInMonth / daysElapsed;
      projection = {
        projectedIvaDebito: Math.round(ivaDebito * factor),
        projectedIvaAAbonar: Math.round(ivaAAbonar * factor),
        daysElapsed,
        daysInMonth,
      };
    }

    return NextResponse.json({
      month: `${year}-${String(month).padStart(2, "0")}`,
      local: {
        orderCount,
        ordersWithCost,
        totalSales: Math.round(totalSales),
        ivaDebito: Math.round(ivaDebito),
        ivaCreditoImportacion: Math.round(creditoImportacion),
        ivaCreditoComisionesML: Math.round(creditoComisionesML),
        ivaCreditoEnvioML: Math.round(creditoEnvioML),
        ivaCreditoCourier: Math.round(creditoCourier),
        ivaCreditoFiscalTotal: Math.round(creditoFiscalTotal),
        ivaAAbonar: Math.round(ivaAAbonar),
      },
      projection,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("IVA summary error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
