# Panel ML — AM Motos Repuestos

Dashboard de gestión de ventas para vendedor de MercadoLibre Argentina (AM Motos Repuestos).

---

## 1. Arquitectura General

```
┌─────────────────────────────────────────────────────────────┐
│                     MercadoLibre API                        │
│   /orders  /shipments  /claims  /items/visits            │
└─────────────────┬───────────────────────────────────────────┘
                  │ Worker (cada 10 min)
                  ▼
          ┌───────────────────┐
          │   SQLite DB       │
          │  (data/ml.db)    │
          └───────┬───────────┘
                  │ Queries
                  ▼
          ┌───────────────────┐
          │  Next.js App      │
          │  (React Server    │
          │   + Client)       │
          └───────────────────┘
```

**Stack:**
- Next.js (App Router, TypeScript)
- SQLite via `better-sqlite3`
- MercadoLibre REST API

---

## 2. Worker — Sincronización en Segundo Plano

Se ejecuta con `npm run worker`. Todos los jobs comparten la misma DB SQLite.

| Job | Intervalo | Descripción |
|-----|-----------|-------------|
| `refresh-check` | 10 min | Verifica si el token de acceso está por expirar y lo renueva automáticamente |
| `sync-orders` | 10 min | Fetcha todas las órdenes de los últimos 90 días desde ML API y las upserta en la DB (INSERT ON CONFLICT UPDATE). Detecta cambios de status (cancelaciones, confirmaciones, etc.) |
| `sync-shipments` | 4 horas | Para órdenes con status `paid`, fetcha el estado del envío desde ML y lo guarda en `shipments` |
| `sync-visits` | 10 min | Fetcha visitas de items de los últimos 30 días |
| `sync-claims` | 10 min | Para órdenes activas, consulta el estado de reclamos en ML y actualiza `orders.claim_status` |

**Importante:** `sync-orders` sempre re-fetcha TODAS las órdenes del rango de lookback (90 días) y hace UPSERT — si una orden cambió de status en ML (ej: `paid` → `cancelled`), se actualiza en la DB. Esto garantiza que el dashboard siempre refleja el estado real de ML.

---

## 3. Base de Datos

### 3.1 Tabla `orders`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | ID de orden de ML |
| `status` | TEXT | Estado: `paid`, `confirmed`, `partially_paid`, `cancelled`, `invalid`, `payment_required`, `payment_in_process` |
| `status_detail` | TEXT | Detalle del estado |
| `date_created` | INTEGER | Timestamp Unix (ms) de creación |
| `date_closed` | INTEGER | Timestamp de cierre |
| `total_amount` | REAL | Monto total de la venta |
| `currency_id` | TEXT | Moneda (ej: `ARS`) |
| `buyer_id` | INTEGER | ID del comprador |
| `buyer_nickname` | TEXT | Nick del comprador |
| `items_json` | TEXT | JSON array con items de la orden |
| `payments_json` | TEXT | JSON array con pagos |
| `shipping_json` | TEXT | JSON con datos de envío |
| `tags_json` | TEXT | Tags de ML (ej: `["paid","not_delivered"]`) |
| `sale_fee` | REAL | Comisión real cobrada por ML (viene de la API) |
| `claim_status` | TEXT | `opened`, `closed` o `null` |
| `raw_json` | TEXT | Respuesta completa de ML |
| `synced_at` | INTEGER | Timestamp de última sincronización |

### 3.2 Tabla `order_costs`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `order_id` | INTEGER PK | FK a `orders.id` |
| `cost` | REAL | Costo del producto (neto sin IVA) en ARS |
| `ml_fee_pct` | REAL | Porcentaje de comisión ML (default 15%) |
| `notes` | TEXT | Notas opcionales del vendedor |
| `logistic_mode` | TEXT | `iva` o `kilos` (legacy, ya no se usa activamente) |
| `weight_kg` | REAL | Peso del producto en kg |
| `gain` | REAL | Ganancia manual ingresada por el usuario (null = calcular automáticamente) |
| `ml_envio` | REAL | Costo de envío de ML en ARS (default 7000) |
| `updated_at` | INTEGER | Timestamp de última modificación |

### 3.3 Tabla `shipments`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | ID del envío |
| `order_id` | INTEGER | FK a `orders.id` |
| `status` | TEXT | Estado: `pending`, `handling`, `ready_to_ship`, `shipped`, `delivered`, `cancelled`, `not_delivered` |
| `substatus` | TEXT | Subestado |
| `tracking_number` | TEXT | Número de tracking |
| `logistic_type` | TEXT | Tipo logístico |
| `mode` | TEXT | Modo: `me2`, `me1`, `custom` |
| `cost` | REAL | Costo del envío desde ML |
| `date_first_printed` | INTEGER | Timestamp cuando se imprimió la etiqueta |
| `date_delivered` | INTEGER | Timestamp de entrega |

### 3.4 Tabla `ml_credentials`

Tokens OAuth de la cuenta de ML (access_token, refresh_token, expiry).

---

## 4. Cálculo de Ganancias — Fórmula Completa

### 4.1 Constants

```typescript
USD_PER_KG = 15          // Costo del courier en USD por kg
DEFAULT_DOLLAR_RATE = 1600  // Tipo de cambio USD→ARS por default
ENVIO_FIJO = 7000        // Costo de envío de ML por default
DEFAULT_ML_FEE_PCT = 15  // Porcentaje default de comisión ML
```

### 4.2 Inputs del Modal

| Campo | Default | Descripción |
|-------|---------|-------------|
| `cost` | 0 | Costo del producto (neto sin IVA) en ARS |
| `ml_envio` | 7000 | Costo de envío de ML en ARS |
| `weight_kg` | 0.5 | Peso del producto en kg |
| `dollar_official` | 1600 | Tipo de cambio USD/ARS (ingresado por el usuario) |
| `ml_fee_pct` | 15 | Porcentaje de comisión ML |
| `gain` | "" (vacío) | Si se llena, sobreescribe el cálculo automático |

### 4.3 Paso a Paso del Cálculo

**Dato inicial:** `totalAmount` = precio de venta total que pagó el buyer (incluye IVA)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. SEPARACIÓN DE IVA                                                │
│                                                                      │
│    netSalePrice = totalAmount / 1.21                               │
│                                                                      │
│    Ejemplo: $304.562,00 / 1.21 = $251.538,84                       │
│    ivaDebit = totalAmount - netSalePrice = $53.023,16             │
│    (Esto es lo que cobramos al buyer — va a AFIP)                   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 2. COMISIÓN DE MERCADOLIBRE                                         │
│                                                                      │
│    Si ML API devuelve sale_fee → usar ese valor                     │
│    Sino → mlFeeAmount = totalAmount * (ml_fee_pct / 100)           │
│                                                                      │
│    mlFeeAmount = $304.562,00 * 0.15 = $45.684,30                   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 3. PERCEPCIONES IMPOSITIVAS                                        │
│                                                                      │
│    percepcion1 = totalAmount * 0.01                                │
│               = $304.562,00 * 0.01 = $3.045,62                     │
│    (1% de percepcion IVA sobre el total)                            │
│                                                                      │
│    percepcion3 = mlFeeAmount * 0.03                                │
│               = $45.684,30 * 0.03 = $1.370,53                       │
│    (3% de percepcion sobre la comisión ML)                           │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 4. DERECHOS DE IMPORTACIÓN                                          │
│                                                                      │
│    iibb = netSalePrice * 0.18                                      │
│         = $251.538,84 * 0.18 = $45.276,99                          │
│    (18% sobre el precio neto)                                        │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 5. COSTO DE CUOTAS                                                 │
│                                                                      │
│    cuotasCost = totalAmount * 0.06                                  │
│               = $304.562,00 * 0.06 = $18.273,72                     │
│    (6% del total por ofrecer cuotas sin interés)                     │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 6. COSTO DEL COURIER (envío internacional)                          │
│                                                                      │
│    courierCostUSD = weightKg * USD_PER_KG                           │
│                   = 0.5 kg * 15 USD/kg = $7,50 USD                  │
│                                                                      │
│    courierCostARS = courierCostUSD * dollarOfficial                   │
│                  = $7,50 * $1.600 = $12.000,00 ARS                 │
│                                                                      │
│    (Se muestra el hint: "0.50 kg × 7.50 USD")                     │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.4 Fórmula Final de Ganancia

```
calculatedGain = netSalePrice
               - percepcion1
               - percepcion3
               - iibb
               - mlFeeAmount
               - mlEnvio
               - cuotasCost
               - courierCostARS
               - cost
```

**Ejemplo numérico completo:**

| Concepto | Valor |
|----------|-------|
| Precio de venta | $304.562,00 |
| Precio neto (÷ 1.21) | $251.538,84 |
| IVA Débito (21%) | $53.023,16 |
| Comisión ML (−15%) | −$45.684,30 |
| Costo por ofrecer cuotas (6%) | −$18.273,72 |
| Percepción IVA (1%) | −$3.045,62 |
| Percepción s/comisión (3%) | −$1.370,53 |
| Derechos de Importación (18%) | −$45.276,99 |
| Costo producto | −$cost |
| Envío ML | −$7.000,00 |
| Costo Courier (ARS) | −$12.000,00 |
| **Ganancia neta** | **= $119.188,68 − cost** |

### 4.5 Override Manual

```
if (gainInput !== "") {
    gain = parseFloat(gainInput)   // Usa valor manual
} else {
    gain = calculatedGain          // Usa resultado de la fórmula
}
```

Si el usuario ingresa un valor en "Ganancia manual", ese valor se guarda en `order_costs.gain` y se usa directamente sin recalcular. Si el campo está vacío, se recalcula desde la fórmula.

---

## 5. Dónde se Usa la Fórmula

### 5.1 Modal de Detalle de Orden (`components/order-detail-modal.tsx`)

- Línea 112-115: calcula `courierCostUSD`, `courierCostARS`, `calculatedGain`
- Componente `Breakdown`: muestra cada fila con los valores desglosados
- Al guardar: hace POST a `/api/orders/[id]/cost`

### 5.2 Columna GANANCIA en la Tabla (`components/orders-table.tsx`)

```typescript
const calculatedGain = netSale - percepcion1 - percepcion3 - iibb
  - mlFeeAmt - mlEnvio - cuotasCost - courierARS - (cost?.cost ?? 0);

const gain = cost?.gain != null
  ? cost.gain                    // Si hay gain manual, usarla
  : cost
  ? calculatedGain               // Si no, calcular
  : null;                        // Si no hay cost, mostrar "—"
```

### 5.3 MonthlyGainsGrid (`components/monthly-gains-grid.tsx`)

El grid mensual consume `/api/monthly-gains` que llama a `getMonthlyGains()` en `lib/db/queries.ts`. Esta función:

1. Busca todas las órdenes del rango con `order_costs` JOIN
2. Para cada orden: usa `stored_gain` si existe, sino calcula con la fórmula
3. Acumula `totalGain`, `totalSales`, `totalCosts` por mes

---

## 6.flujo de Datos de Costos

```
┌─────────────────────────────────┐
│  User abre modal de una orden   │
└──────────────┬──────────────────┘
               │ GET /api/orders/{id}/cost
               ▼
       ┌──────────────┐
       │  SQLite DB   │  ← order_costs (cost, ml_fee_pct, weight_kg,
       │  ml_envio, gain, etc.)
       └──────┬───────┘
               │ POST /api/orders/{id}/cost (al guardar)
               ▼
       ┌──────────────┐
       │  SQLite DB   │  ← upsertOrderCost()
       └──────────────┘
```

---

## 7. Envíos — Badge "Enviado"

La tabla de órdenes muestra un badge verde "Enviado" cuando el shipment associated no está en estados pendientes.

**Lógica (`/api/orders/shipments`):**

1. Consultar DB para saber si ya tiene shipment cacheado
2. Si `status ∈ {delivered, shipped, ready_to_ship}` → usar cache (ya está enviado)
3. Si `status ∈ {pending, handling, cancelled, not_delivered}` → re-verificar con ML API
4. Si ML API confirma que se envió → guardar en DB (upsert)
5. Si `status ∉ shipped/delivered/ready_to_ship` → no mostrar badge

**Worker:** `sync-shipments` corre cada 4 horas para mantener la DB de shipments actualizada. La tabla siempre verifica contra ML API para estados pendientes.

---

## 8. Dashboard KPIs

El dashboard muestra 6 KPIs con datos que cambian según el tab activo (día/semana/mes/2meses/3meses):

| KPI | Label dinámico | Descripción |
|-----|---------------|-------------|
| Facturación aprobada | — | `totalRevenue` = sum de `paid/confirmed/partially_paid` |
| Ventas brutas | — | `grossSales` = suma de todos los statuses |
| Ticket promedio | — | `totalRevenue / (paid + confirmed)` |
| Tasa de concreción | — | `(paid + confirmed) / total * 100` |
| Ventas [período] | Sí | Solo órdenes procesadas (`processed.count`) |
| Total [período] | Sí | Todas las órdenes del período (procesadas + pendientes + cancelac. abiertas + canceladas) |

**Subtext de Total [período]:**
```
"X procesadas · Y pendientes · Z cancelac. abiertas · W canceladas"
```

**Tone del badge Total:**
- 0% canceladas → verde (success)
- >0% y ≤15% → amarillo (warning)
- >15% → rojo (danger)

---

## 9. Estados de Órdenes en ML

| Status | Significado |
|--------|-------------|
| `paid` | Pagada y confirmada |
| `confirmed` | Confirmada (pago en proceso) |
| `partially_paid` | Pago parcial |
| `payment_required` | Esperando pago |
| `payment_in_process` | Pago en proceso |
| `pending_cancel` | Cancelación solicitada (abierta) |
| `cancelled` | Cancelada |
| `invalid` | Inválida |

**Claim statuses:**
- `orders.claim_status = 'opened'` → badge rojo "Reclamo abierto"
- `orders.claim_status = 'closed'` → badge amarillo "Reclamo cerrado"
- `orders.claim_status = null` → sin badge

---

## 10. Rutas API

| Ruta | Método | Descripción |
|------|--------|-------------|
| `/api/orders` | GET | Lista de órdenes con filtros y paginación |
| `/api/orders/stats` | GET | KPIs agregados para un rango de fechas |
| `/api/orders/[id]/cost` | GET/POST/DELETE | CRUD de costos de una orden |
| `/api/orders/costs` | GET | Bulk fetch de costos para múltiples órdenes (`?ids=1,2,3`) |
| `/api/orders/shipments` | GET | Estado de envíos (híbrido DB+ML API) |
| `/api/orders/export` | GET | Exporta a Excel o PDF |
| `/api/monthly-gains` | GET | Ganancias mensuales agregadas |
| `/api/shipments` | GET | Shipments para despachos pendientes |

---

## 11. Notas Importantes

- **Sin modo "Kilos"**: La bifurcación IVA/Kilos fue eliminada. Hay una sola fórmula que incluye el costo del courier para todos los pedidos.
- **Ganancia manual**: Si se ingresa un valor en "Ganancia manual", ese valor se guarda en la DB y no se recalcula. Solo se recalcula si el campo está vacío.
- **Costo courier**: Se calcula como `weight_kg * 15 USD/kg * dollar_official`. Si `weight_kg = 0`, el costo es 0.
- **`ml_envio` default**: Si no está seteado en la DB, se usa 7000 ARS como default.
- **Tipo de cambio**: El valor de `dollarOfficial` (ARS/USD) se ingresa manualmente en el modal y no se persiste — se usa el valor actual del input para el cálculo en tiempo real.
