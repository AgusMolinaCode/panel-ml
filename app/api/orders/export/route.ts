import { NextRequest, NextResponse } from "next/server";
import { queryOrders } from "@/lib/db/queries";
import { NotAuthenticatedError } from "@/lib/ml/auth";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoney, formatDate } from "@/lib/format";

/**
 * GET /api/orders/export?from=ms&to=ms&status=&format=excel|pdf
 * Streams an Excel or PDF file with the filtered orders.
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const url = new URL(req.url);
    const from = parseInt(url.searchParams.get("from") ?? "", 10);
    const to = parseInt(url.searchParams.get("to") ?? "", 10);
    const statusParam = url.searchParams.get("status");
    const format = (url.searchParams.get("format") ?? "excel").toLowerCase();

    const opts: Parameters<typeof queryOrders>[0] = {
      limit: 1000,
      offset: 0,
      sortBy: "date_created",
      sortDir: "desc",
    };
    if (!Number.isNaN(from) && from > 0) opts.fromMs = from;
    if (!Number.isNaN(to) && to > 0) opts.toMs = to;
    if (statusParam) opts.statuses = statusParam.split(",").map((s) => s.trim()).filter(Boolean);

    const { orders, total } = queryOrders(opts);

    if (format === "pdf") {
      return generatePdf(orders, total, from, to);
    }
    return generateExcel(orders, total, from, to);
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function generateExcel(orders: ReturnType<typeof queryOrders>["orders"], total: number, from: number, to: number): Response {
  const rows = orders.map((o) => ({
    Fecha: formatDate(o.date_created),
    "ID Orden": o.id,
    Estado: o.status,
    Comprador: o.buyer_nickname ?? "",
    "Buyer ID": o.buyer_id ?? "",
    Items: o.items.map((i) => `${i.quantity}× ${i.title}`).join(" | "),
    "Total ARS": o.total_amount,
    Moneda: o.currency_id,
    "Cerrada": o.date_closed ? formatDate(o.date_closed) : "",
    "Método de pago": o.payments[0]?.payment_method_id ?? "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 12 },
    { wch: 40 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 16 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Órdenes");

  // Add a header sheet with metadata
  const meta = [
    ["Reporte de Órdenes — AM Motos"],
    ["Generado", new Date().toISOString()],
    ["Rango", `${formatDate(from)} – ${formatDate(to)}`],
    ["Total órdenes", total],
    [],
  ];
  const wsMeta = XLSX.utils.aoa_to_sheet(meta);
  XLSX.utils.book_append_sheet(wb, wsMeta, "Info");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ordenes-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}

function generatePdf(orders: ReturnType<typeof queryOrders>["orders"], total: number, from: number, to: number): Response {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // Header
  doc.setFontSize(16);
  doc.text("AM Motos — Reporte de Órdenes", 14, 15);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generado: ${new Date().toLocaleString("es-AR")}`, 14, 22);
  doc.text(`Rango: ${formatDate(from)} – ${formatDate(to)}`, 14, 27);
  doc.text(`Total: ${total} órdenes`, 14, 32);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 38,
    head: [["Fecha", "ID", "Estado", "Comprador", "Items", "Total"]],
    body: orders.map((o) => [
      formatDate(o.date_created),
      `#${o.id}`,
      o.status,
      o.buyer_nickname ?? "—",
      o.items.map((i) => `${i.quantity}× ${i.title}`).join(", ").slice(0, 60),
      formatMoney(o.total_amount, o.currency_id),
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [10, 10, 11], textColor: [250, 250, 250] },
    alternateRowStyles: { fillColor: [240, 240, 240] },
  });

  const buf = Buffer.from(doc.output("arraybuffer"));
  return new Response(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ordenes-${new Date().toISOString().slice(0, 10)}.pdf"`,
    },
  });
}