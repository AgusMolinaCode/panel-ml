/**
 * Fuente única de verdad para el cálculo de ganancias del panel.
 *
 * Usado por: order-detail-modal, orders-table, monthly-gains-grid,
 * lib/db/queries (getMonthlyGains) y price-calculator.
 *
 * Modelo de ganancia post-venta (lo que queda de bolsillo por orden):
 *
 *   neto_venta   = total / 1.21            (separamos el IVA débito → AFIP)
 *   ganancia     = neto_venta
 *                  − comisión ML           (sale_fee API, o % fallback sobre bruto)
 *                  − cuotas 6%             (sobre neto)
 *                  − percepción IVA 1%     (sobre neto)
 *                  − percepción s/comisión 3%
 *                  − IIBB 0.25%            (sobre neto)
 *                  − derechos import 21%   (sobre FOB — alineado con price.js)
 *                  − costo producto (ARS)
 *                  − envío ML (ARS)
 *                  − courier (kg × USD/kg × dólar)
 */

// ─── Constantes ──────────────────────────────────────────────────────────────

/** Dólar blue de referencia si no hay cotización en vivo (doc: ML_DOLLAR_BLUE) */
export const DOLLAR_BLUE_DEFAULT = 1650;

/** Costo courier por kg en USD (doc: SHIPPING_COST_PER_KG) */
export const COURIER_USD_PER_KG = 18;

/** Comisión ML fallback cuando la API no trae sale_fee: 20% + IVA 21% = 24.2% (doc) */
export const DEFAULT_ML_FEE_PCT = 24.2;

/** Envío ML por defecto a cargo del vendedor (ARS) */
export const DEFAULT_ML_ENVIO = 7000;

export const IVA_RATE = 0.21;
export const CUOTAS_RATE = 0.06;
export const PERCEPCION_IVA_RATE = 0.01;
export const PERCEPCION_COMISION_RATE = 0.03;
export const IIBB_RATE = 0.0025;
export const DERECHOS_IMPORT_RATE = 0.21;

/**
 * Corte de eras: desde el 1 de agosto 2026 se trabaja con IVA y se usa la
 * fórmula completa (calculateOrderGain). Antes de esa fecha se usa la
 * fórmula simple (calculateOrderGainLegacy), como se venía cargando manual.
 */
export const IVA_ERA_START_MS = new Date(2026, 7, 1).getTime(); // 1 ago 2026 00:00 local

/** true si la orden pertenece a la era IVA (>= 1 ago 2026) */
export function isIvaEra(dateCreatedMs: number): boolean {
  return dateCreatedMs >= IVA_ERA_START_MS;
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface GainInput {
  /** Total cobrado al comprador (bruto, con IVA) */
  totalAmount: number;
  /** Comisión real de ML desde la API (si existe, tiene prioridad) */
  saleFee?: number | null;
  /** % de comisión fallback si no hay saleFee (default: DEFAULT_ML_FEE_PCT) */
  mlFeePct?: number | null;
  /** Costo del producto en ARS */
  costARS: number;
  /** Envío ML a cargo del vendedor (ARS). null/undefined → DEFAULT_ML_ENVIO */
  mlEnvio?: number | null;
  /** Peso en kg para el courier */
  weightKg?: number | null;
  /** Cotización dólar. null/undefined → DOLLAR_BLUE_DEFAULT */
  dollarRate?: number | null;
}

export interface GainBreakdown {
  totalAmount: number;
  netSalePrice: number;
  ivaDebit: number;
  mlFeeAmount: number;
  cuotasCost: number;
  percepcionIva: number;
  percepcionComision: number;
  iibb: number;
  derechosImport: number;
  costARS: number;
  mlEnvio: number;
  courierCostUSD: number;
  courierCostARS: number;
  dollarRate: number;
  gain: number;
  /** Margen sobre el precio neto de venta */
  marginPct: number;
}

// ─── Cálculos ────────────────────────────────────────────────────────────────

/** Precio neto sin IVA (bruto ÷ 1.21) */
export function netOfIVA(totalAmount: number): number {
  return totalAmount / (1 + IVA_RATE);
}

/** IIBB del panel: 0.25% sobre el neto */
export function calcIibb(totalAmount: number): number {
  return netOfIVA(totalAmount) * IIBB_RATE;
}

/**
 * NETO ML: lo que liquida Mercado Libre por la orden.
 * total − comisión − envío − IIBB
 */
export function calcMlNeto(
  totalAmount: number,
  saleFee: number | null | undefined,
  mlFeePct: number | null | undefined,
  mlEnvio: number | null | undefined
): number {
  const fee = resolveMlFee(totalAmount, saleFee, mlFeePct);
  const envio = mlEnvio ?? 0;
  return totalAmount - fee - envio - calcIibb(totalAmount);
}

function resolveMlFee(
  totalAmount: number,
  saleFee: number | null | undefined,
  mlFeePct: number | null | undefined
): number {
  if (saleFee != null) return saleFee;
  const pct = mlFeePct ?? DEFAULT_ML_FEE_PCT;
  return totalAmount * (pct / 100);
}

/** Ganancia neta de una orden descontando TODOS los componentes. */
export function calculateOrderGain(input: GainInput): GainBreakdown {
  const dollar = input.dollarRate && input.dollarRate > 0 ? input.dollarRate : DOLLAR_BLUE_DEFAULT;
  const totalAmount = input.totalAmount;
  const netSalePrice = netOfIVA(totalAmount);

  const mlFeeAmount = resolveMlFee(totalAmount, input.saleFee, input.mlFeePct);
  const cuotasCost = netSalePrice * CUOTAS_RATE;
  const percepcionIva = netSalePrice * PERCEPCION_IVA_RATE;
  const percepcionComision = mlFeeAmount * PERCEPCION_COMISION_RATE;
  const iibb = netSalePrice * IIBB_RATE;
  // Derechos de importación: 21% sobre el FOB (costo del producto), NO sobre
  // el neto de venta. Alineado con la fórmula de publicación (price.js) y con
  // la realidad aduanera: los derechos se calculan sobre el valor FOB/CIF.
  // costARS = FOB_USD × dólar, así que costARS × 21% = derechos en ARS.
  const derechosImport = input.costARS * DERECHOS_IMPORT_RATE;
  const mlEnvio = input.mlEnvio ?? DEFAULT_ML_ENVIO;
  const courierCostUSD = (input.weightKg ?? 0) * COURIER_USD_PER_KG;
  const courierCostARS = courierCostUSD * dollar;

  const gain =
    netSalePrice -
    mlFeeAmount -
    cuotasCost -
    percepcionIva -
    percepcionComision -
    iibb -
    derechosImport -
    input.costARS -
    mlEnvio -
    courierCostARS;

  return {
    totalAmount,
    netSalePrice,
    ivaDebit: totalAmount - netSalePrice,
    mlFeeAmount,
    cuotasCost,
    percepcionIva,
    percepcionComision,
    iibb,
    derechosImport,
    costARS: input.costARS,
    mlEnvio,
    courierCostUSD,
    courierCostARS,
    dollarRate: dollar,
    gain,
    marginPct: netSalePrice > 0 ? (gain / netSalePrice) * 100 : 0,
  };
}

// ─── Fórmula legacy (órdenes anteriores al 1 ago 2026) ───────────────────────

export interface LegacyGainInput {
  totalAmount: number;
  saleFee?: number | null;
  costARS: number;
  mlEnvio?: number | null;
}

/**
 * Fórmula simple pre-agosto 2026 (como se venía calculando manualmente):
 *   ganancia = total − comisión (sale_fee o 19%) − envío − IIBB 0.25% bruto − costo
 * Sin IVA, cuotas, percepciones, derechos ni courier.
 */
export function calculateOrderGainLegacy(input: LegacyGainInput): number {
  const saleFee = input.saleFee ?? input.totalAmount * 0.19;
  const envio = input.mlEnvio ?? 0;
  const iibb = input.totalAmount * 0.0025;
  return input.totalAmount - saleFee - envio - iibb - input.costARS;
}

/**
 * Atajo: elige la fórmula según la fecha de la orden.
 * La ganancia manual (stored) siempre tiene prioridad en los callers.
 */
export function gainForOrder(
  dateCreatedMs: number,
  input: GainInput
): number {
  if (isIvaEra(dateCreatedMs)) {
    return calculateOrderGain(input).gain;
  }
  return calculateOrderGainLegacy({
    totalAmount: input.totalAmount,
    saleFee: input.saleFee,
    costARS: input.costARS,
    mlEnvio: input.mlEnvio,
  });
}
