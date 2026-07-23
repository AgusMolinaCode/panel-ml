/**
 * Stable date formatting helpers.
 * Use these on the server and pass the formatted string to client components
 * to avoid hydration mismatches caused by `toLocaleString` (locale-dependent).
 *
 * All outputs are in Argentina timezone (UTC-3) which is the user's market.
 */

const TZ_OFFSET_MIN = -180; // ART (UTC-3)

function toArtDate(ms: number): Date {
  // Shift the timestamp so toISOString().slice(0, 16) reflects ART wall clock.
  return new Date(ms + TZ_OFFSET_MIN * 60_000);
}

/** "2026-06-18 12:50" — fixed-format, locale-independent, no hydration risk. */
export function formatDateTime(ms: number): string {
  const d = toArtDate(ms);
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** "18/06/2026" — DD/MM/YYYY using fixed math, no toLocaleString. */
export function formatDate(ms: number): string {
  const d = toArtDate(ms);
  const iso = d.toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Stable currency formatting via Intl.NumberFormat on the server only. */
export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: currency || "ARS",
    minimumFractionDigits: 2,
  }).format(amount);
}

const STATUS_LABELS_ES: Record<string, string> = {
  paid: "Pagada",
  confirmed: "Confirmada",
  partially_paid: "Pago parcial",
  payment_required: "Pago requerido",
  payment_in_process: "Pago en proceso",
  pending_cancel: "Cancelación pendiente",
  cancelled: "Cancelada",
  invalid: "Inválida",
  delivered: "Entregada",
  pending: "Pendiente",
  ready_to_ship: "Lista para despachar",
  shipped: "Enviada",
  not_delivered: "No entregada",
  closed: "Cerrada",
  delayed: "Demorada",
  handling: "En preparación",
  // sync log statuses
  success: "Éxito",
  error: "Error",
  partial: "Parcial",
  running: "En curso",
};

export function translateStatus(status: string): string {
  return STATUS_LABELS_ES[status.toLowerCase()] ?? status;
}