# Pricing — Panel ML: Fórmulas de Ganancia y Deducciones

> Documento de referencia completo de cómo el panel calcula ganancias, costos y deducciones.
> **Fuente única de verdad en el código:** `lib/pricing.ts`.
>
> Última actualización: 2026-08-05 (fix `dollar_rate` + derechos 21% s/FOB).

---

## 1. Conceptos base

| Término | Definición |
|---|---|
| **Bruto (P)** | Lo que pagó el comprador (`total_amount` de la orden). Incluye IVA. |
| **Neto** | `P ÷ 1.21`. Es la base sobre la que se miden la mayoría de las deducciones y el margen. |
| **IVA Débito** | `P − Neto = P × 0.21/1.21`. Lo cobraste al comprador pero es de AFIP. |
| **FOB** | Costo del producto en USD (sin IVA de importación — ese IVA computa como Crédito Fiscal). |
| **Ganancia neta** | Lo que queda de bolsillo por orden después de TODAS las deducciones. |
| **Margen %** | `ganancia ÷ neto × 100`. |

---

## 2. Eras: corte 1 de agosto 2026

```ts
IVA_ERA_START_MS = new Date(2026, 7, 1)  // 1 ago 2026 00:00 local
isIvaEra(dateCreatedMs) = dateCreatedMs >= IVA_ERA_START_MS
```

| Era | Fórmula | Función |
|---|---|---|
| **≥ 1 ago 2026** | Completa con IVA, cuotas, percepciones, derechos y courier | `calculateOrderGain()` |
| **< 1 ago 2026** | Simple (como se cargaba manual) — NO SE TOCA | `calculateOrderGainLegacy()` |

El selector automático es `gainForOrder(dateCreatedMs, input)`.

**Prioridad en TODOS los consumidores** (tabla, grilla mensual, `getMonthlyGains`):
1. Si hay `gain` manual guardada en `order_costs.gain` → se usa esa, siempre.
2. Si no → se calcula con la fórmula según la era.

---

## 3. Fórmula completa (era IVA) — `calculateOrderGain()`

```
neto        = P ÷ 1.21
ganancia    = neto
              − comisión ML
              − cuotas 6%           (sobre neto)
              − percepción IVA 1%   (sobre neto)
              − percepción s/comisión 3% (sobre la comisión)
              − IIBB 0.25%          (sobre neto)
              − derechos import 21% (sobre FOB — ver §5)
              − costo producto (FOB × dólar)
              − envío ML (ARS fijo)
              − courier (kg × 18 USD/kg × dólar)
```

### Constantes (`lib/pricing.ts`)

| Constante | Valor | Se aplica sobre |
|---|---|---|
| `IVA_RATE` | 0.21 | separación bruto → neto |
| `CUOTAS_RATE` | 0.06 | neto |
| `PERCEPCION_IVA_RATE` | 0.01 | neto |
| `PERCEPCION_COMISION_RATE` | 0.03 | comisión ML |
| `IIBB_RATE` | 0.0025 | neto |
| `DERECHOS_IMPORT_RATE` | 0.21 | **FOB** (costARS) |
| `COURIER_USD_PER_KG` | 18 USD/kg | peso |
| `DEFAULT_ML_FEE_PCT` | 24.2% | bruto (fallback de comisión: 20% × 1.21) |
| `DEFAULT_ML_ENVIO` | $7.000 ARS | fijo (fallback de envío) |
| `DOLLAR_BLUE_DEFAULT` | $1.650 ARS/USD | fallback de cotización |

### Comisión ML (resolución)

```
si order.sale_fee (API) existe  → se usa ese valor real
si no                           → bruto × (ml_fee_pct guardado ÷ 100)
si tampoco hay                  → bruto × 24.2%
```

### Costo del producto

Se guarda **ya convertido a ARS** en `order_costs.cost`:

```
costARS = FOB_USD × dollar_rate
```

> ⚠️ Es un COSTO, no parte del precio: el precio de venta es solo el ingreso;
> hay que descontar lo que costó comprar la mercadería.

### Courier

```
courierUSD = peso_kg × 18
courierARS = courierUSD × dollar_rate
```

---

## 4. Fórmula legacy (pre-agosto) — NO MODIFICAR

```ts
gain = total − saleFee(o 19% del bruto) − envío − IIBB(0.25% del BRUTO) − costo
```

Sin IVA, cuotas, percepciones, derechos ni courier.

---

## 5. Derechos de importación — historial del modelo

| Versión | Cálculo | Estado |
|---|---|---|
| Original | 18% del **neto de venta** | ❌ Incorrecto — base equivocada |
| **Actual (2026-08-05)** | 21% del **FOB** (`costARS × 0.21`) | ✅ Alineado con `price.js` y con la realidad aduanera |

**Por qué:** los derechos aduaneros se calculan sobre el valor FOB/CIF de la mercadería, no sobre el precio de venta. Con el modelo viejo, en una venta de $220.990 (FOB USD 36) se descontaban $32.874 en vez de $12.020 — se comía ~$20.850 de margen ficticio por orden.

El calculador de publicación del panel (`components/price-calculator.tsx`) ya usaba 21% s/FOB; ahora ambos lados (poner precio / medir ganancia) usan el mismo modelo.

---

## 6. Cotización del dólar — `dollar_rate` persistido

**Problema resuelto (2026-08-05):** el modal calculaba con el dólar cargado (ej. 1.590) pero al guardar no se persistía la ganancia ni el dólar; la tabla recalculaba con el fallback 1.650 → diferencias (ej. $7.439 vs $6.899, exactamente el delta del courier: 9 USD × 60 = $540).

**Solución:** columna `order_costs.dollar_rate REAL` (migración automática `ALTER TABLE` en `lib/db/index.ts`).

| Flujo | Comportamiento |
|---|---|
| Modal abre orden sin costo | Dólar = blue API (`dolarapi.com/v1/dolares/blue`, `venta + 50`), fallback 1.650 |
| Modal abre orden guardada | Dólar = `dollar_rate` guardado (reabre con los mismos números) |
| Modal guarda | Persiste `dollar_rate` junto al resto |
| Tabla / grilla / `getMonthlyGains` | Recalculan con `dollarRate: cost.dollar_rate`; `NULL` (registros viejos) → fallback 1.650 |

> ⚠️ Órdenes guardadas antes del fix: abrir y apretar **Guardar** una vez para persistir el dólar.

---

## 7. NETO ML — `calcMlNeto()`

Lo que liquida Mercado Libre (columna "NETO ML" de la tabla):

```
NETO ML = total − comisión − envío ML − IIBB(0.25% del neto)
```

Fallback de comisión en la tabla: 19% pre-agosto, 24.2% era IVA.

---

## 8. Modos de carga en el modal (`order-detail-modal.tsx`)

| Modo | Qué se ingresa | Qué se guarda |
|---|---|---|
| Normal (null) | FOB USD, fee %, envío, peso, dólar | `cost`(ARS), `gain = null` → tabla recalcula |
| Costo manual (`manual`) | Costo en USD directo | `manual_cost_input`, `gain = null` |
| Ganancia manual (`manualGain`) | Ganancia final en ARS | `gain = valor` → **prioriza siempre** |

Al guardar también se persisten: `ml_fee_pct`, `ml_envio`, `weight_kg`, `iibb` (`calcIibb(total)`), `ml_neto` (`calcMlNeto`), `dollar_rate`.

---

## 9. Ejemplo verificado — Orden #2000017745877978 (2026-08-04)

Input: P = $220.990 · FOB USD 36 · 0.5 kg · dólar 1.590 · fee 22.2% · envío $7.000

| Línea | Cálculo | Valor |
|---|---|---|
| Neto | 220.990 ÷ 1.21 | $182.636,36 |
| IVA Débito | 220.990 − 182.636,36 | $38.353,64 |
| Comisión ML | 220.990 × 0,222 | −$49.059,78 |
| Cuotas 6% | 182.636,36 × 0,06 | −$10.958,18 |
| Percepción IVA 1% | 182.636,36 × 0,01 | −$1.826,36 |
| Percepción s/comisión 3% | 49.059,78 × 0,03 | −$1.471,79 |
| IIBB 0,25% | 182.636,36 × 0,0025 | −$456,59 |
| Derechos 21% s/FOB | (36 × 1.590) × 0,21 | −$12.020,40 |
| Costo producto | 36 × 1.590 | −$57.240,00 |
| Envío ML | fijo | −$7.000,00 |
| Courier | 0,5 kg × 18 USD × 1.590 | −$14.310,00 |
| **Ganancia neta** | | **$28.293,26** |
| **Margen** | 28.293,26 ÷ 182.636,36 | **15,5%** |

> Con el modelo viejo de derechos (18% s/neto = −$32.874,55) la misma orden daba $7.439,11 (4,1%) — de ahí la sensación de "no deja ganancia".

---

## 10. Consumidores de las fórmulas (mantener sincronizados)

| Archivo | Uso |
|---|---|
| `lib/pricing.ts` | **Fuente única de verdad** — no duplicar lógica fuera de acá |
| `components/order-detail-modal.tsx` | Breakdown en vivo + guardado de costos |
| `components/orders-table.tsx` | Columna Ganancia y NETO ML |
| `components/monthly-gains-grid.tsx` | Ganancias agregadas por mes (cliente) |
| `lib/db/queries.ts` → `getMonthlyGains()` | Ganancias por mes (servidor) |
| `components/price-calculator.tsx` | Calculadora de precio de publicación (lado inverso) |
| `app/api/orders/[id]/cost/route.ts` | GET/POST/DELETE de costos por orden |

---

## 11. Relación con la fórmula de publicación (`lib/price.ts`)

El pricing de publicación y el panel deben modelar la MISMA realidad. A partir de agosto 2026 ambos lados están alineados:

| Concepto | Publicación (`lib/price.ts`) | Medición (`lib/pricing.ts`) |
|---|---|---|
| Derechos | 21% s/FOB ✅ | 21% s/FOB ✅ |
| Comisión ML | 24.2% como fracción del bruto | sale_fee real o 24.2% fallback |
| IVA débito | ÷ 1.21 (fracción 17.36%) | ÷ 1.21 |
| Cuotas 6% | ✅ descuenta sobre neto real | ✅ descuenta sobre neto |
| Percepción IVA 1% | ✅ descuenta sobre neto real | ✅ descuenta sobre neto |
| Percepción s/comisión 3% | ✅ descuenta sobre comisión | ✅ descuenta sobre comisión |
| IIBB 0.25% | ✅ descuenta sobre neto real | ✅ descuenta sobre neto |
| Envío ML $7.000 | ✅ gross-up x comisión y suma al final | ✅ descuenta del neto ML |
| Flete/courier | $18/kg (con surcharge 0.2/0.6 kg) | $18/kg (peso cargado) |
| Handling $7 | **No resta** (profit puro) | no se descuenta (queda en ganancia) |

### Funciones de `lib/price.ts`

| Función | Descripción |
|---|---|
| `calculateMLPrice(dealer, weightLbs, dollarRate)` | Precio ML sin redondeo |
| `priceWithMLMonthlyFee(dealer, weightLbs, dollarRate)` | Precio ML con redondeo psicológico |
| `breakdownMLPrice(dealer, weightLbs, dollarRate)` | Breakdown sin redondeo |
| `breakdownMLMonthlyFee(dealer, weightLbs, dollarRate)` | Breakdown con redondeo |
| `getMarginByPrice(dealerPrice)` | Margen aplicado según tier |
| `getCalculatedWeightKg(weightLbs)` | Peso + surcharge de empaque |

### Fórmula de publicación

```
costo_total_usd     = dealer + dealer × 0.21 + peso_total × 18
costo_con_ganancia  = costo_total × (1 + margin_tier)

iva_fraccion        = 0.21 / 1.21
comision_fraccion   = 0.20 × 1.21
base_neto_real      = 1 − iva_fraccion − comision_fraccion
gastos_neto_frac    = (0.06 + 0.01 + 0.0025) × base_neto_real
percep_comision_frac= 0.03 × comision_fraccion
retained            = 1 − iva_fraccion − comision_fraccion − gastos_neto_frac − percep_comision_frac

precio_base_ars     = (costo_con_ganancia × dólar) / retained
envio_grossup_ars   = 7000 / (1 − comision_fraccion)
precio_final_ars    = ceil((precio_base + envio_grossup + 10) / 5000) × 5000 − 10
```

> **Nota sobre redondeo:** la fórmula escrita en el prompt original (`ceil(x/5000)*5000 + 990`) no coincide con los ejemplos ni con el precio real del panel ($224.990 para x ≈ $220.631). La fórmula correcta es `ceil((x + 10) / 5000) × 5000 − 10`, que produce: $125.000 → $129.990, $199.000 → $199.990, $220.631 → $224.990.

> **Nota:** el handling $7 USD no se descuenta del precio de publicación ML porque se considera profit puro. La calculadora del panel (`components/price-calculator.tsx`) sigue incluyéndolo como costo nominal en el canal WhatsApp, donde no hay comisiones de ML.
