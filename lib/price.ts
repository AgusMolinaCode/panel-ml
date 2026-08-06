/**
 * Fuente única de verdad para el cálculo de precios de publicación en Mercado Libre.
 *
 * Fórmula corregida para la era IVA (responsables inscriptos) — agosto 2026.
 * Contempla todos los descuentos reales de ML para que la ganancia medida
 * matchee con la ganancia esperada.
 */

// ─── Constantes ──────────────────────────────────────────────────────────────

/** Multiplicador aplicado sobre el margen base por tier */
export const MARGIN_MULTIPLIER = 1.175;

/** Costo de flete/courier en USD por kg */
export const SHIPPING_COST_PER_KG = 18;

/** Comisión base de ML (sin IVA). El valor con IVA 21% es 21% (incluye cuotas, REMOVIDO el 6% separate) */
export const ML_COMISION_RATE = 0.17355;

/** IVA general */
export const IVA_RATE = 0.21;

/** Percepción de IVA (sobre el neto real) */
export const PERCEP_IVA_RATE = 0.01;

/** Percepción sobre comisión (sobre la comisión con IVA) */
export const PERCEP_COMISION_RATE = 0.03;

/** Ingresos brutos (sobre el neto real) */
export const IIBB_RATE = 0.0025;

/** Envío de ML a cargo del vendedor (ARS fijo por orden) */
export const ENVIO_ML_ARS = 7000;

/** Conversión de libras a kilogramos */
export const LBS_TO_KG = 0.453592;

/** Redondeo psicológico: paso */
export const PSYCHOLOGICAL_STEP = 5000;

/** Redondeo psicológico: pad final */
export const PSYCHOLOGICAL_PAD = 990;

// ─── Margen por tier ─────────────────────────────────────────────────────────

/**
 * Devuelve el margen aplicado según el precio dealer.
 * El margen base se multiplica por `MARGIN_MULTIPLIER`.
 */
export function getMarginByPrice(dealerPrice: number): number {
  let baseMargin: number;
  if (dealerPrice <= 50) baseMargin = 0.33;
  else if (dealerPrice <= 100) baseMargin = 0.28;
  else if (dealerPrice <= 200) baseMargin = 0.23;
  else if (dealerPrice <= 300) baseMargin = 0.16;
  else if (dealerPrice <= 400) baseMargin = 0.13;
  else if (dealerPrice <= 500) baseMargin = 0.1;
  else baseMargin = 0.08;
  return baseMargin * MARGIN_MULTIPLIER;
}

// ─── Peso con surcharge ──────────────────────────────────────────────────────

export interface CalculatedWeight {
  /** Peso total en kg (real + surcharge de empaque) */
  totalWeightKg: number;
  /** Surcharge aplicado en kg */
  surchargeUsed: number;
}

/**
 * Calcula el peso total para flete incluyendo el surcharge de empaque:
 * - 0.2 kg si el peso real es menor a 2 kg
 * - 0.6 kg si el peso real es mayor o igual a 2 kg
 */
export function getCalculatedWeightKg(weightLbs: number): CalculatedWeight {
  const weightKg = (weightLbs || 0) * LBS_TO_KG;
  const surcharge = weightKg < 2 ? 0.2 : 0.6;
  return { totalWeightKg: weightKg + surcharge, surchargeUsed: surcharge };
}

// ─── Tipos de breakdown ──────────────────────────────────────────────────────

export interface MLPriceBreakdown {
  dealer_price_usd: number;
  margin_applied_pct: number;
  weight_kg_used: number;
  surcharge_kg: number;
  derechos_estadistica_usd: number;
  flete_usd: number;
  costo_total_usd: number;
  costo_con_ganancia_usd: number;
  dollar_rate: number;
  final_price_ars: number;
  retained_fraction: number;
  iva_debito_ars: number;
  comision_ml_ars: number;
  percep_comision_ars: number;
  percep_iva_ars: number;
  iibb_ars: number;
  envio_ml_ars: number;
  neto_final_ars: number;
}

// ─── Cálculo interno ─────────────────────────────────────────────────────────

function calculateBreakdown(
  dealerPrice: number,
  weightLbs: number,
  dollarRate: number,
  round: boolean
): MLPriceBreakdown {
  const margin = getMarginByPrice(dealerPrice);
  const { totalWeightKg, surchargeUsed } = getCalculatedWeightKg(weightLbs);

  // Costos base USD (sin handling: es profit puro, no se descuenta del precio)
  const derechosUSD = dealerPrice * IVA_RATE;
  const fleteUSD = totalWeightKg * SHIPPING_COST_PER_KG;
  const costoTotalUSD = dealerPrice + derechosUSD + fleteUSD;
  const costoConGananciaUSD = costoTotalUSD * (1 + margin);

  // Fracciones de descuento sobre el precio bruto P
  const ivaFraccion = IVA_RATE / (1 + IVA_RATE);
  const comisionFraccion = ML_COMISION_RATE * (1 + IVA_RATE);
  const baseNetoReal = 1 - ivaFraccion - comisionFraccion;
  const gastosNetoFraccion = (PERCEP_IVA_RATE + IIBB_RATE) * baseNetoReal;
  const percepComisionFraccion = PERCEP_COMISION_RATE * comisionFraccion;

  const retained =
    1 - ivaFraccion - comisionFraccion - gastosNetoFraccion - percepComisionFraccion;

  // Precio base (sin envío): lo necesario para cubrir costo + ganancia
  const precioBaseARS = (costoConGananciaUSD * dollarRate) / retained;

  // Envío ML: se gross-up solo por comisión (ML cobra comisión sobre el envío)
  const envioGrossUpARS = ENVIO_ML_ARS / (1 - comisionFraccion);

  let finalPriceARS = precioBaseARS + envioGrossUpARS;

  if (round) {
    finalPriceARS = Math.ceil((finalPriceARS + 10) / PSYCHOLOGICAL_STEP) * PSYCHOLOGICAL_STEP - 10;
  }

  // Breakdown de descuentos sobre el precio final publicado
  const ivaDebitoARS = finalPriceARS * ivaFraccion;
  const comisionMLARS = finalPriceARS * comisionFraccion;
  const percepComisionARS = comisionMLARS * PERCEP_COMISION_RATE;
  const baseNetoARS = finalPriceARS * baseNetoReal;
  const percepIvaARS = baseNetoARS * PERCEP_IVA_RATE;
  const iibbARS = baseNetoARS * IIBB_RATE;

  const netoFinalARS =
    finalPriceARS -
    ivaDebitoARS -
    comisionMLARS -
    percepComisionARS -
    percepIvaARS -
    iibbARS -
    ENVIO_ML_ARS;

  return {
    dealer_price_usd: dealerPrice,
    margin_applied_pct: margin * 100,
    weight_kg_used: totalWeightKg,
    surcharge_kg: surchargeUsed,
    derechos_estadistica_usd: derechosUSD,
    flete_usd: fleteUSD,
    costo_total_usd: costoTotalUSD,
    costo_con_ganancia_usd: costoConGananciaUSD,
    dollar_rate: dollarRate,
    final_price_ars: Math.round(finalPriceARS),
    retained_fraction: retained,
    iva_debito_ars: Math.round(ivaDebitoARS),
    comision_ml_ars: Math.round(comisionMLARS),
    percep_comision_ars: Math.round(percepComisionARS),
    percep_iva_ars: Math.round(percepIvaARS),
    iibb_ars: Math.round(iibbARS),
    envio_ml_ars: ENVIO_ML_ARS,
    neto_final_ars: Math.round(netoFinalARS),
  };
}

// ─── API pública ─────────────────────────────────────────────────────────────

/** Precio ML sin redondeo psicológico. */
export function calculateMLPrice(
  dealerPrice: number,
  weightLbs: number,
  dollarRate: number
): number {
  return breakdownMLPrice(dealerPrice, weightLbs, dollarRate).final_price_ars;
}

/** Precio ML con redondeo psicológico (múltiplo de 5000 + 990). */
export function priceWithMLMonthlyFee(
  dealerPrice: number,
  weightLbs: number,
  dollarRate: number
): number {
  return breakdownMLMonthlyFee(dealerPrice, weightLbs, dollarRate).final_price_ars;
}

/** Breakdown completo del precio ML sin redondeo. */
export function breakdownMLPrice(
  dealerPrice: number,
  weightLbs: number,
  dollarRate: number
): MLPriceBreakdown {
  return calculateBreakdown(dealerPrice, weightLbs, dollarRate, false);
}

/** Breakdown completo del precio ML con redondeo psicológico. */
export function breakdownMLMonthlyFee(
  dealerPrice: number,
  weightLbs: number,
  dollarRate: number
): MLPriceBreakdown {
  return calculateBreakdown(dealerPrice, weightLbs, dollarRate, true);
}
