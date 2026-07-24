"use client";

import * as React from "react";
import { Calculator, Loader2, Save, Trash2, TrendingUp, TrendingDown, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Badge, statusToTone } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Table, THead, TBody, TR, TH, TD } from "./ui/table";
import { formatMoney, formatDateTime, translateStatus } from "@/lib/format";
import type { Order, OrderItem, OrderPayment, OrderShipping, OrderCost } from "@/lib/db/types";
import { cn } from "@/lib/utils";

interface Props {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_ML_FEE_PCT = 15;
const USD_PER_KG = 15;
const DEFAULT_DOLLAR_RATE = 1600;

export function OrderDetailModal({ order, open, onOpenChange }: Props) {
  const [costData, setCostData] = React.useState<OrderCost | null>(null);
  const [loadingCost, setLoadingCost] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [costInput, setCostInput] = React.useState("0");
  const [feeInput, setFeeInput] = React.useState(String(DEFAULT_ML_FEE_PCT));
  
  const [mlEnvioInput, setMlEnvioInput] = React.useState("7000");
  const [weightKgInput, setWeightKgInput] = React.useState("0.5");
  const [dollarOfficialInput, setDollarOfficialInput] = React.useState(String(DEFAULT_DOLLAR_RATE));
  const [gainInput, setGainInput] = React.useState("");
  const [manualCostInput, setManualCostInput] = React.useState("");
  const [costError, setCostError] = React.useState<string | null>(null);
  const [copiedSku, setCopiedSku] = React.useState(false);
  const [costCurrency, setCostCurrency] = React.useState<"USD" | "ARS">("USD");
  const [costMode, setCostMode] = React.useState<"product" | "manual" | "manualGain" | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("https://dolarapi.com/v1/dolares/blue");
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { venta: number };
          setDollarOfficialInput(String(data.venta + 50));
        }
      } catch {
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!order || !open) {
      setCostData(null);
      setGainInput("");
      setManualCostInput("");
      setCostInput("0");
      setCostMode(null);
      return;
    }
    let cancelled = false;
    setLoadingCost(true);
    setCostError(null);
    (async () => {
      try {
        const res = await fetch(`/api/orders/${order.id}/cost`);
        const data = (await res.json()) as { cost: OrderCost | null };
        if (cancelled) return;
        setCostData(data.cost);
        setCostInput(data.cost ? String(data.cost.cost) : "0");
        setFeeInput(data.cost ? String(data.cost.ml_fee_pct) : String(DEFAULT_ML_FEE_PCT));
        setGainInput("");
        setMlEnvioInput(data.cost?.ml_envio != null ? String(data.cost.ml_envio) : "7000");
        setWeightKgInput(data.cost?.weight_kg != null ? String(data.cost.weight_kg) : "0.5");
        setManualCostInput(data.cost?.manual_cost_input ?? "");
        if ((data.cost?.manual_cost_input ?? "") !== "") {
          setCostMode("manual");
          setCostCurrency((data.cost?.manual_cost_currency as "USD" | "ARS") ?? "USD");
        } else if (data.cost?.gain != null) {
          setCostMode("manualGain");
          setGainInput(String(data.cost.gain));
          setCostCurrency("USD");
        } else {
          setCostMode(null);
          setCostCurrency("ARS");
        }
      } catch (err) {
        if (!cancelled) {
          setCostError(err instanceof Error ? err.message : "Error");
        }
      } finally {
        if (!cancelled) setLoadingCost(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order, open]);

  if (!order) return null;

  const totalItems = order.items.reduce((sum, i) => sum + i.quantity, 0);
  const createdAt = formatDateTime(order.date_created);
  const closedAt = order.date_closed ? formatDateTime(order.date_closed) : "—";
  const dispatchMs =
    order.date_closed != null ? order.date_closed - order.date_created : null;
  const dispatchLabel =
    dispatchMs != null
      ? dispatchMs < 60_000
        ? `${Math.round(dispatchMs / 1000)}s`
        : dispatchMs < 3_600_000
        ? `${Math.round(dispatchMs / 60_000)} min`
        : dispatchMs < 86_400_000
        ? `${(dispatchMs / 3_600_000).toFixed(1)} h`
        : `${(dispatchMs / 86_400_000).toFixed(1)} días`
      : "—";

  const costRaw = parseFloat(costInput) || 0;
  const feePct = parseFloat(feeInput) || 0;
  const mlEnvio = parseFloat(mlEnvioInput) || 0;
  const weightKg = parseFloat(weightKgInput) || 0;
  const dollarOfficial = parseFloat(dollarOfficialInput) || DEFAULT_DOLLAR_RATE;
  // costInput always stores ARS — on change, convert from USD if needed
  const cost = costCurrency === "USD" ? costRaw * dollarOfficial : costRaw;

  const saleFeeFromApi = order.sale_fee ?? null;
  const mlFeeAmount =
    saleFeeFromApi != null
      ? saleFeeFromApi
      : order.total_amount * (feePct / 100);

  const totalAmount = order.total_amount;
  const netSalePrice = totalAmount / 1.21;
  const percepcion1 = totalAmount * 0.01;
  const percepcion3 = mlFeeAmount * 0.03;
  const iibb = netSalePrice * 0.18;
  const cuotasCost = totalAmount * 0.06;
  const courierCostUSD = weightKg * USD_PER_KG;
  const courierCostARS = courierCostUSD * dollarOfficial;

  const calculatedGain = (totalAmount - (order.sale_fee ?? totalAmount * 0.19) - mlEnvio - (totalAmount * 0.0025)) - cost;
  const manualCostRaw = parseFloat(manualCostInput) || 0;
  const manualCostARS = costCurrency === "USD" ? manualCostRaw * dollarOfficial : manualCostRaw;
  const gain = (() => {
    if (costMode === null) return calculatedGain;
    if (costMode === "manualGain") return parseFloat(gainInput) || 0;
    if (costMode === "manual") return calculatedGain + cost - manualCostARS;
    return calculatedGain;
  })();
  const marginPct = totalAmount > 0 ? (gain / totalAmount) * 100 : 0;

  async function handleSave(): Promise<void> {
    if (!order) return;
    setSaving(true);
    setCostError(null);
    try {
      const mlNeto = order.total_amount - (order.sale_fee ?? order.total_amount * 0.19) - mlEnvio - (order.total_amount * 0.0025);
      const manualCostRaw = parseFloat(manualCostInput) || 0;
      const manualCostARS = costCurrency === "USD" ? manualCostRaw * dollarOfficial : manualCostRaw;
      const gainToSave = (() => {
        if (costMode === "manualGain") return parseFloat(gainInput) || 0;
        if (costMode === "manual") return manualCostRaw > 0 ? mlNeto - manualCostARS : null;
        return undefined;
      })();

      const body: Record<string, unknown> = {
        cost: costMode === "manual" ? manualCostARS : cost,
        ml_fee_pct: feePct,
        ml_envio: mlEnvio > 0 ? mlEnvio : null,
        weight_kg: weightKg > 0 ? weightKg : null,
        iibb: order.total_amount * 0.0025,
        ml_neto: mlNeto,
      };
      if (costMode === null) {
        body.gain = null;
        body.manual_cost_input = null;
        body.manual_cost_currency = null;
      } else if (costMode === "manualGain") {
        body.gain = gainToSave;
        body.manual_cost_input = null;
        body.manual_cost_currency = costCurrency;
      } else if (costMode === "manual") {
        body.gain = null;
        body.manual_cost_input = manualCostInput || null;
        body.manual_cost_currency = costCurrency;
      }

      const res = await fetch(`/api/orders/${order.id}/cost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { success?: boolean; cost?: OrderCost; error?: string };
      if (!res.ok || !data.success) {
        setCostError(data.error ?? `Error ${res.status}`);
        return;
      }
      const saved = data.cost ?? null;
      setCostData(saved);
      setCostInput(saved ? String(saved.cost) : "0");
      setFeeInput(saved ? String(saved.ml_fee_pct) : String(DEFAULT_ML_FEE_PCT));
      setGainInput(saved?.gain != null ? String(saved.gain) : "");
      setMlEnvioInput(saved?.ml_envio != null ? String(saved.ml_envio) : "");
      setWeightKgInput(saved?.weight_kg != null ? String(saved.weight_kg) : "");
      setManualCostInput(saved?.manual_cost_input ?? "");
      if (saved?.manual_cost_currency) {
        setCostCurrency(saved.manual_cost_currency as "USD" | "ARS");
      } else {
        setCostCurrency("ARS");
      }
      if (saved?.gain != null) {
        setCostMode("manualGain");
      } else if ((saved?.manual_cost_input ?? "") !== "") {
        setCostMode("manual");
      } else {
        setCostMode(null);
      }
      window.dispatchEvent(new CustomEvent("panel-ml:gains-changed", { detail: saved }));
      onOpenChange(false);
    } catch (err) {
      setCostError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!order) return;
    if (!confirm("¿Borrar el costo y notas de esta orden?")) return;
    setSaving(true);
    try {
      await fetch(`/api/orders/${order.id}/cost`, { method: "DELETE" });
      setCostData(null);
      setCostInput("0");
      setFeeInput(String(DEFAULT_ML_FEE_PCT));
      setMlEnvioInput("7000");
      setWeightKgInput("0.5");
      setGainInput("");
      setManualCostInput("");
      setCostMode(null);
      window.dispatchEvent(new CustomEvent("panel-ml:gains-changed", { detail: order.id }));
    } catch (err) {
      setCostError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>Orden #{order.id}</span>
            <Badge tone={statusToTone(order.status)} dot>
              {translateStatus(order.status)}
            </Badge>
            {order.items[0]?.seller_sku && (
              <span className="flex items-center gap-1">
                <span className="font-mono text-xs text-muted-foreground">
                  SKU: {order.items.map((i) => i.seller_sku).filter(Boolean).join(", ")}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const skus = order.items.map((i) => i.seller_sku).filter(Boolean).join(", ");
                    void navigator.clipboard.writeText(skus).then(() => {
                      setCopiedSku(true);
                      setTimeout(() => setCopiedSku(false), 1500);
                    });
                  }}
                  className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                  title="Copiar SKU"
                >
                  {copiedSku ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </span>
            )}
            {order.claim_status === "opened" && (
              <Badge tone="danger">Reclamo abierto</Badge>
            )}
            {order.claim_status === "closed" && (
              <Badge tone="warning">Reclamo cerrado</Badge>
            )}
            {order.status_detail && (
              <span className="text-xs font-normal text-muted-foreground">
                · {order.status_detail}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Creada el {createdAt}
            {order.date_closed != null && ` · Cerrada el ${closedAt}`}
            {" · "}Despacho: {dispatchLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Summary label="Total" value={formatMoney(order.total_amount, order.currency_id)} />
          <Summary label="Items" value={`${totalItems} (${order.items.length} SKUs)`} />
          <Summary label="Comprador" value={order.buyer_nickname ?? `#${order.buyer_id}`} />
        </div>

        <div className="rounded-xl border border-border bg-card-elevated overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Calculator className="h-3.5 w-3.5" />
              </div>
              <h4 className="text-sm font-semibold">Tu costo y ganancia</h4>
            </div>
            {costData && (
              <span className="text-xs text-muted-foreground">
                Guardado: {formatDateTime(costData.updated_at)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Costo de producto (neto sin IVA)</label>
                <div className="flex items-center gap-2">
                  <Select value={costCurrency} onValueChange={(v) => setCostCurrency(v as "USD" | "ARS")}>
                    <SelectTrigger className="h-9 w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="ARS">ARS</SelectItem>
                    </SelectContent>
                  </Select>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={costInput}
                    onChange={(e) => {
                      if (e.target.value === "" || e.target.value === "0") {
                        setCostMode(null);
                        setCostInput(e.target.value);
                        setManualCostInput("");
                        setGainInput("");
                      } else {
                        setCostMode(null);
                        setCostInput(e.target.value);
                        setManualCostInput("");
                        setGainInput("");
                      }
                    }}
                    disabled={costMode !== null && costMode !== "product"}
                    placeholder="0"
                    className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>
              <NumberField
                label="Costo de Envío ML (ARS)"
                value={mlEnvioInput}
                onChange={setMlEnvioInput}
                placeholder="0"
                suffix="ARS"
              />
              <NumberField
                label="Peso del producto (Kg)"
                value={weightKgInput}
                onChange={setWeightKgInput}
                placeholder="0"
                suffix="kg"
                hint={`${USD_PER_KG} USD/kg × ${formatMoney(dollarOfficial, "ARS")}/USD = ${formatMoney(USD_PER_KG * dollarOfficial, "ARS")}/kg`}
              />
              <NumberField
                label="Precio del Dólar (ARS)"
                value={dollarOfficialInput}
                onChange={setDollarOfficialInput}
                placeholder={String(DEFAULT_DOLLAR_RATE)}
                suffix="ARS/USD"
              />
              <NumberField
                label="Comisión ML"
                value={feeInput}
                onChange={setFeeInput}
                placeholder={String(DEFAULT_ML_FEE_PCT)}
                suffix="%"
                hint={
                  saleFeeFromApi != null
                    ? `Sale fee API: ${formatMoney(saleFeeFromApi, order.currency_id)} (usado)`
                    : undefined
                }
              />

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Tu costo del producto (para calcular ganancia)
                </label>
                <div className="flex items-center gap-2">
                  <Select value={costCurrency} onValueChange={(v) => setCostCurrency(v as "USD" | "ARS")}>
                    <SelectTrigger className="h-9 w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="ARS">ARS</SelectItem>
                    </SelectContent>
                  </Select>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={manualCostInput}
                    onChange={(e) => {
                      if (e.target.value === "") {
                        setCostMode(null);
                        setManualCostInput("");
                        setCostInput("0");
                        setGainInput("");
                      } else {
                        setCostMode("manual");
                        setManualCostInput(e.target.value);
                        setCostInput("0");
                        setGainInput("");
                      }
                    }}
                    disabled={costMode !== null && costMode !== "manual"}
                    placeholder="NETO ML - este valor = Ganancia"
                    className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Al guardar: NETO ML − este valor = Ganancia
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Ganancia manual (opcional)
                </label>
                <input
                  type="number"
                  step="any"
                  value={gainInput}
                  onChange={(e) => {
                    if (e.target.value === "") {
                      setCostMode(null);
                      setGainInput("");
                      setCostInput("0");
                      setManualCostInput("");
                    } else {
                      setCostMode("manualGain");
                      setGainInput(e.target.value);
                      setCostInput("0");
                      setManualCostInput("");
                    }
                  }}
                  disabled={costMode !== null && costMode !== "manualGain"}
                  placeholder={costMode !== null ? "Ganancia fija" : "Ganancia que quieras"}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 pr-12 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="text-[10px] text-muted-foreground">
                  {costMode !== "manualGain" ? "Completá uno de los campos de arriba" : "Se usa este valor como ganancia fija"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button onClick={handleSave} loading={saving} size="sm">
                  <Save className="h-3.5 w-3.5" />
                  Guardar
                </Button>
                {costData && (
                  <Button onClick={handleDelete} loading={saving} size="sm" variant="ghost">
                    <Trash2 className="h-3.5 w-3.5" />
                    Borrar
                  </Button>
                )}
              </div>

              {costError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                  {costError}
                </div>
              )}
              {loadingCost && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Cargando costo guardado…
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Cálculo en vivo
              </div>

              <Breakdown
                totalAmount={totalAmount}
                netSalePrice={netSalePrice}
                ivaDebit={totalAmount - netSalePrice}
                costNet={cost}
                mlFeeAmount={mlFeeAmount}
                percepcion1={percepcion1}
                percepcion3={percepcion3}
                iibb={iibb}
                mlEnvio={mlEnvio}
                cuotasCost={cuotasCost}
                courierCostUSD={courierCostUSD}
                courierCostARS={courierCostARS}
                weightKg={weightKg}
                gain={gain}
                marginPct={marginPct}
                currency={order.currency_id}
                saleFeeFromApi={saleFeeFromApi}
              />
            </div>
          </div>
        </div>

          <div className="space-y-2">
          <h4 className="text-sm font-semibold">Items</h4>
          <Table>
            <THead>
              <TR>
                <TH>SKU</TH>
                <TH>Título</TH>
                <TH className="text-right">Cant.</TH>
                <TH className="text-right">Unitario</TH>
                <TH className="text-right">Subtotal</TH>
              </TR>
            </THead>
            <TBody>
              {order.items.map((item, i) => (
                <ItemRow key={i} item={item} currency={order.currency_id} />
              ))}
            </TBody>
          </Table>
        </div>

        {order.payments.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Pagos</h4>
            <div className="space-y-1.5 text-sm">
              {order.payments.map((p, i) => (
                <PaymentRow key={i} payment={p} currency={order.currency_id} />
              ))}
            </div>
          </div>
        )}

        <ShippingSection shipping={order.shipping} />
      </DialogContent>
    </Dialog>
  );
}

function Breakdown({
  totalAmount,
  netSalePrice,
  ivaDebit,
  costNet,
  mlFeeAmount,
  percepcion1,
  percepcion3,
  iibb,
  mlEnvio,
  cuotasCost,
  courierCostUSD,
  courierCostARS,
  weightKg,
  gain,
  marginPct,
  currency,
  saleFeeFromApi,
}: {
  totalAmount: number;
  netSalePrice: number;
  ivaDebit: number;
  costNet: number;
  mlFeeAmount: number;
  percepcion1: number;
  percepcion3: number;
  iibb: number;
  mlEnvio: number;
  cuotasCost: number;
  courierCostUSD: number;
  courierCostARS: number;
  weightKg: number;
  gain: number;
  marginPct: number;
  currency: string;
  saleFeeFromApi: number | null;
}) {
  return (
    <>
      <Row label="Precio de venta" value={formatMoney(totalAmount, currency)} />
      <Row label="Precio neto (÷ 1.21)" value={formatMoney(netSalePrice, currency)} muted />
      <Row label="IVA Débito (21%)" value={formatMoney(ivaDebit, currency)} muted hint="Lo cobraste al buyer — pasa a AFIP" />
      <div className="my-1.5 border-t border-border/60" />
      {saleFeeFromApi != null ? (
        <Row label="Comisión ML" value={`− ${formatMoney(mlFeeAmount, currency)}`} muted hint="sale_fee API" />
      ) : (
        <Row label="Comisión ML" value={`− ${formatMoney(mlFeeAmount, currency)}`} muted />
      )}
      <Row label="Costo por ofrecer cuotas (6%)" value={`− ${formatMoney(cuotasCost, currency)}`} muted />
      <Row label="Percepción IVA (1%)" value={`− ${formatMoney(percepcion1, currency)}`} muted />
      <Row label="Percepción s/comisión (3%)" value={`− ${formatMoney(percepcion3, currency)}`} muted />
      <Row label="Derechos de Importación (18%)" value={`− ${formatMoney(iibb, currency)}`} muted />
      <Row label="Costo producto" value={`− ${formatMoney(costNet, currency)}`} muted />
      <Row label="Envío ML" value={`− ${formatMoney(mlEnvio, currency)}`} muted />
      <Row
        label="Costo Courier (ARS)"
        value={`− ${formatMoney(courierCostARS, currency)}`}
        muted
        hint={`(${weightKg.toFixed(2)} kg × ${courierCostUSD.toFixed(2)} USD)`}
      />
      <div className="my-2 border-t border-border/60" />
      <Row
        label="Ganancia neta"
        value={formatMoney(gain, currency)}
        strong
        tone={gain >= 0 ? "success" : "danger"}
        icon={gain >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      />
      <Row
        label="Margen %"
        value={`${marginPct.toFixed(1)}%`}
        tone={marginPct >= 30 ? "success" : marginPct >= 10 ? "warning" : "danger"}
        small
      />
    </>
  );
}

function ItemRow({ item, currency }: { item: OrderItem; currency: string }) {
  const subtotal = item.unit_price * item.quantity;
  return (
    <TR>
      <TD>
        {item.seller_sku ? (
          <span className="font-mono text-xs text-muted-foreground">{item.seller_sku}</span>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}
      </TD>
      <TD>
        <div className="font-medium">{item.title}</div>
        {item.variation_attributes && item.variation_attributes.length > 0 && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {item.variation_attributes.map((v) => v.value_name).join(" · ")}
          </div>
        )}
      </TD>
      <TD className="text-right tabular-nums">{item.quantity}</TD>
      <TD className="text-right tabular-nums">{formatMoney(item.unit_price, currency)}</TD>
      <TD className="text-right font-medium tabular-nums">{formatMoney(subtotal, currency)}</TD>
    </TR>
  );
}

function PaymentRow({ payment, currency }: { payment: OrderPayment; currency: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <Badge tone={payment.status === "approved" ? "success" : "warning"}>
          {payment.status ?? "—"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {payment.payment_method_id ?? "—"}{" "}
          {payment.payment_type_id ? `· ${payment.payment_type_id}` : ""}
        </span>
        {payment.date_approved && (
          <span className="text-xs text-muted-foreground">
            · {formatDateTime(Date.parse(payment.date_approved))}
          </span>
        )}
      </div>
      <span className="font-medium tabular-nums">
        {payment.transaction_amount != null
          ? formatMoney(payment.transaction_amount, payment.currency_id ?? currency)
          : "—"}
      </span>
    </div>
  );
}

function ShippingSection({ shipping }: { shipping: OrderShipping | null }) {
  if (!shipping) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Envío</h4>
      <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <Field label="ID" value={shipping.id?.toString() ?? "—"} mono />
        <Field label="Estado" value={shipping.status ?? "—"} />
        <Field label="Logística" value={shipping.logistic_type ?? "—"} />
        <Field label="Tracking" value={shipping.tracking_number ?? "—"} mono />
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card-elevated px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 ${mono ? "font-mono text-xs" : ""} break-all`}>{value}</div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
  suffix,
  hint,
  prefix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  hint?: string;
  prefix?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {prefix}
          </span>
        )}
        <input
          type="number"
          step="any"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`flex h-9 w-full rounded-md border border-border bg-background py-1.5 pr-12 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${prefix ? "pl-8" : "pl-3"}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Row({
  label,
  value,
  muted = false,
  strong = false,
  small = false,
  tone,
  icon,
  hint,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  small?: boolean;
  tone?: "success" | "warning" | "danger";
  icon?: React.ReactNode;
  hint?: string;
}) {
  const toneClass = cn(
    tone === "success" && "text-success",
    tone === "warning" && "text-warning",
    tone === "danger" && "text-destructive"
  );
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className={cn("flex flex-col gap-0.5", muted && "text-muted-foreground")}>
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        {hint && <span className="text-[10px] text-muted-foreground/70">{hint}</span>}
      </span>
      <span
        className={cn(
          "tabular-nums whitespace-nowrap",
          small ? "text-xs" : strong ? "text-base font-bold" : "font-medium",
          toneClass
        )}
      >
        {value}
      </span>
    </div>
  );
}
