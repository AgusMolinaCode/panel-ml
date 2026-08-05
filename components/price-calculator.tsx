"use client";

import * as React from "react";
import { Calculator, Copy, Check, RefreshCw, MessageCircle, GripVertical, X, TrendingUp, Package } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const SHIPPING_PER_KG = 18;
const HANDLING_USD = 7;
const DERECHOS_RATE = 0.21;
const IVA_RATE = 0.21;
const ML_COMISION_CON_IVA = 0.242;
const LBS_TO_KG = 0.453592;
const PSYCHOLOGICAL_STEP = 5000;
const PSYCHOLOGICAL_PAD = 990;

interface PriceBreakdown {
  dealer_price_usd: number;
  weight_lbs: number;
  weight_kg: number;
  surcharge_kg: number;
  total_weight_kg: number;
  derechos_usd: number;
  flete_usd: number;
  handling_usd: number;
  costo_total_usd: number;
  margin_pct: number;
  costo_con_ganancia_usd: number;
  dollar_rate: number;
  neto_ars: number;
  iva_ars: number;
  comision_ml_ars: number;
  precio_bruto_ars: number;
  precio_final_ars: number;
}

function getMargin(dealerPrice: number): number {
  let baseMargin: number;
  if (dealerPrice <= 50) baseMargin = 0.33;
  else if (dealerPrice <= 100) baseMargin = 0.28;
  else if (dealerPrice <= 200) baseMargin = 0.23;
  else if (dealerPrice <= 300) baseMargin = 0.16;
  else if (dealerPrice <= 400) baseMargin = 0.13;
  else if (dealerPrice <= 500) baseMargin = 0.10;
  else baseMargin = 0.08;
  return baseMargin * 1.175;
}

function calculatePrice(dealerPrice: number, weightLbs: number, dollarRate: number, canal: "ml" | "whats"): PriceBreakdown {
  const weightKg = weightLbs * LBS_TO_KG;
  const surcharge = weightKg < 2 ? 0.2 : 0.6;
  const totalWeightKg = weightKg + surcharge;

  const derechos = dealerPrice * DERECHOS_RATE;
  const flete = totalWeightKg * SHIPPING_PER_KG;
  const handling = HANDLING_USD;
  const costoTotal = dealerPrice + derechos + flete + handling;

  const margin = getMargin(dealerPrice);
  const costoConGanancia = costoTotal * (1 + margin);

  const netoARS = costoConGanancia * dollarRate;
  const ivaARS = netoARS * IVA_RATE;
  const netoConIVA = netoARS + ivaARS;

  const precioBruto = canal === "ml"
    ? netoConIVA / (1 - ML_COMISION_CON_IVA)
    : netoConIVA;

  const precioFinal = Math.round(precioBruto / PSYCHOLOGICAL_STEP) * PSYCHOLOGICAL_STEP + PSYCHOLOGICAL_PAD;

  return {
    dealer_price_usd: dealerPrice,
    weight_lbs: weightLbs,
    weight_kg: weightKg,
    surcharge_kg: surcharge,
    total_weight_kg: totalWeightKg,
    derechos_usd: derechos,
    flete_usd: flete,
    handling_usd: handling,
    costo_total_usd: costoTotal,
    margin_pct: margin * 100,
    costo_con_ganancia_usd: costoConGanancia,
    dollar_rate: dollarRate,
    neto_ars: netoARS,
    iva_ars: ivaARS,
    comision_ml_ars: canal === "ml" ? precioBruto * ML_COMISION_CON_IVA : 0,
    precio_bruto_ars: precioBruto,
    precio_final_ars: precioFinal,
  };
}

export function PriceCalculator() {
  const [isFloating, setIsFloating] = React.useState(false);
  const [position, setPosition] = React.useState({ x: 100, y: 100 });
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 });

  const [dealerPrice, setDealerPrice] = React.useState("");
  const [weightKg, setWeightKg] = React.useState("");
  const [weightLbs, setWeightLbs] = React.useState("");
  const [dollarBlue, setDollarBlue] = React.useState<number | null>(null);
  const [dollarLoading, setDollarLoading] = React.useState(true);
  const [copiedMl, setCopiedMl] = React.useState(false);
  const [copiedWhats, setCopiedWhats] = React.useState(false);
  const [showBreakdown, setShowBreakdown] = React.useState(false);
  const [activeBreakdown, setActiveBreakdown] = React.useState<"ml" | "whats" | null>(null);
  const [whatsPreset, setWhatsPreset] = React.useState(1); // 0=oferta, 1=buen precio, 2=mejor, 3=sin oferta

  // Preset multipliers for WhatsApp (applied to the base margin)
  const WHATS_PRESETS = [
    { name: "Oferta", multiplier: 0.7, desc: "Promo" },
    { name: "Buen precio", multiplier: 1.0, desc: "Normal" },
    { name: "Mejor", multiplier: 1.3, desc: "+30%" },
    { name: "Sin oferta", multiplier: 1.6, desc: "Vale" },
  ];

  // Mutually exclusive weight inputs
  const isKgLocked = weightKg !== "" && weightLbs === "";
  const isLbsLocked = weightLbs !== "" && weightKg === "";

  const handleKgChange = (value: string) => {
    setWeightKg(value);
    if (value !== "") setWeightLbs("");
  };

  const handleLbsChange = (value: string) => {
    setWeightLbs(value);
    if (value !== "") setWeightKg("");
  };

  // Calculate lbs from either input
  const lbsFromKg = weightKg !== "" ? parseFloat(weightKg) / LBS_TO_KG : 0;
  const lbsNum = weightLbs !== "" ? parseFloat(weightLbs) : (weightKg !== "" ? lbsFromKg : 0);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("https://dolarapi.com/v1/dolares/blue");
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { venta: number };
          setDollarBlue(data.venta);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setDollarLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dealerNum = parseFloat(dealerPrice) || 0;
  const dollarValue = dollarBlue ?? 0;

  const mlResult = dealerNum > 0 && lbsNum > 0 && dollarValue > 0
    ? calculatePrice(dealerNum, lbsNum, dollarValue, "ml")
    : null;

  const whatsResult = dealerNum > 0 && lbsNum > 0 && dollarValue > 0
    ? calculatePrice(dealerNum, lbsNum, dollarValue, "whats")
    : null;

  // Calculate WhatsApp price with custom margin multiplier
  const calculateWhatsPrice = (multiplier: number) => {
    if (!whatsResult) return 0;
    const baseMargin = whatsResult.margin_pct / 100;
    const adjustedMargin = baseMargin * multiplier;
    const costoConGanancia = whatsResult.costo_total_usd * (1 + adjustedMargin);
    const netoARS = costoConGanancia * dollarValue;
    const netoConIVA = netoARS * 1.21;
    const precioBruto = netoConIVA;
    const precioFinal = Math.round(precioBruto / PSYCHOLOGICAL_STEP) * PSYCHOLOGICAL_STEP + PSYCHOLOGICAL_PAD;
    return precioFinal;
  };

  const whatsPrices = WHATS_PRESETS.map(p => ({
    ...p,
    price: calculateWhatsPrice(p.multiplier),
    gain: calculateWhatsPrice(p.multiplier) - (whatsResult?.costo_total_usd ?? 0) * dollarValue * 1.21,
  }));

  const copyToClipboard = (price: number, setCopied: React.Dispatch<React.SetStateAction<boolean>>) => {
    if (price <= 0) return;
    const formatted = new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
    void navigator.clipboard.writeText(`${formatted} pesos`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const refreshDollar = () => {
    setDollarLoading(true);
    void (async () => {
      try {
        const res = await fetch("https://dolarapi.com/v1/dolares/blue");
        if (res.ok) {
          const data = (await res.json()) as { venta: number };
          setDollarBlue(data.venta);
        }
      } catch { /* ignore */ }
      finally { setDollarLoading(false); }
    })();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".no-drag")) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({ x: Math.max(0, e.clientX - dragOffset.x), y: Math.max(0, e.clientY - dragOffset.y) });
  };

  const handleMouseUp = () => setIsDragging(false);

  const mainContent = (
    <>
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between px-5 py-4 border-b bg-muted/30",
          isFloating ? "cursor-grab active:cursor-grabbing rounded-t-xl" : ""
        )}
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-3">
          {isFloating && <GripVertical className="h-4 w-4 text-muted-foreground no-drag" />}
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold">Calculadora de Precios AM MOTOS</h3>
            <p className="text-xs text-muted-foreground">Cotizá publicación ML y venta WhatsApp</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isFloating ? (
            <Button variant="ghost" size="sm" onClick={() => setIsFloating(true)} className="text-xs h-8 no-drag">
              Soltar
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setIsFloating(false)} className="h-8 w-8 p-0 no-drag">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-6 space-y-6">
        {/* Inputs Row */}
        <div className="grid grid-cols-3 gap-5">
          {/* Dealer Price */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Precio Dealer (USD)</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">USD</span>
              <Input
                type="number"
                step="0.01"
                value={dealerPrice}
                onChange={(e) => setDealerPrice(e.target.value)}
                placeholder="0.00"
                className="pl-14 font-mono h-14 text-lg"
              />
            </div>
          </div>

          {/* Weight inputs */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">Kg</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">kg</span>
                  <Input
                    type="number"
                    step="0.1"
                    value={weightKg}
                    onChange={(e) => handleKgChange(e.target.value)}
                    placeholder="0.0"
                    disabled={isLbsLocked}
                    className={cn("pl-10 font-mono h-14 text-lg", isLbsLocked && "opacity-50")}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">Libras</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">lbs</span>
                  <Input
                    type="number"
                    step="0.1"
                    value={weightLbs}
                    onChange={(e) => handleLbsChange(e.target.value)}
                    placeholder="0.0"
                    disabled={isKgLocked}
                    className={cn("pl-10 font-mono h-14 text-lg", isKgLocked && "opacity-50")}
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground/60 text-center">
              Completá uno · se convierte automáticamente
            </p>
          </div>

          {/* Dollar Blue */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-muted-foreground">Dólar Blue</label>
              <button onClick={refreshDollar} className="p-1 rounded hover:bg-muted transition-colors no-drag" title="Actualizar">
                <RefreshCw className={cn("h-4 w-4 text-muted-foreground", dollarLoading && "animate-spin")} />
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                type="number"
                value={dollarBlue?.toString() ?? ""}
                onChange={(e) => setDollarBlue(parseFloat(e.target.value) || null)}
                placeholder={dollarLoading ? "..." : "0"}
                disabled={dollarLoading}
                className="pl-10 font-mono h-14 text-lg"
              />
            </div>
          </div>
        </div>

        {/* Results */}
        {mlResult && whatsResult && (
          <div className="grid grid-cols-2 gap-5">
            {/* ML Premium */}
            <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Calculator className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">Mercado Libre</p>
                    <p className="text-[10px] text-muted-foreground">Premium + 24.2% comision</p>
                  </div>
                </div>
              </div>
              <div className="text-center min-h-[90px] flex flex-col justify-center">
                <p className="text-3xl xl:text-4xl font-black font-mono text-primary leading-tight truncate">
                  {formatMoney(mlResult.precio_final_ars, "ARS")}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Ganancia: {formatMoney(mlResult.precio_final_ars - (mlResult.costo_total_usd * dollarValue * 1.21), "ARS")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => copyToClipboard(mlResult.precio_final_ars, setCopiedMl)}
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2 h-11"
                >
                  {copiedMl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiedMl ? "Copiado" : "Copiar"}
                </Button>
                <Button
                  onClick={() => { setActiveBreakdown(activeBreakdown === "ml" ? null : "ml"); setShowBreakdown(true); }}
                  variant={activeBreakdown === "ml" ? "default" : "outline"}
                  size="sm"
                  className="h-11 px-4"
                >
                  <TrendingUp className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* WhatsApp */}
            <div className="rounded-xl border-2 border-green-500/20 bg-green-500/5 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
                    <MessageCircle className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-base font-bold">WhatsApp</p>
                    <p className="text-xs text-muted-foreground">Sin comision ML</p>
                  </div>
                </div>
              </div>

              {/* Preset buttons */}
              <div className="grid grid-cols-4 gap-2">
                {whatsPrices.map((preset, idx) => (
                  <button
                    key={idx}
                    onClick={() => setWhatsPreset(idx)}
                    className={cn(
                      "rounded-lg p-2 text-center transition-all border-2",
                      whatsPreset === idx
                        ? "bg-green-500/20 border-green-500 text-green-600"
                        : "bg-muted/50 border-transparent hover:border-green-500/30"
                    )}
                  >
                    <p className="text-[10px] font-medium truncate">{preset.name}</p>
                    <p className="text-sm font-bold font-mono truncate">{formatMoney(preset.price, "ARS")}</p>
                    <p className="text-[9px] text-muted-foreground truncate">+{formatMoney(preset.gain, "ARS")}</p>
                  </button>
                ))}
              </div>

              <div className="text-center min-h-[70px] flex flex-col justify-center">
                <p className="text-3xl xl:text-4xl font-black font-mono text-green-600 leading-tight truncate">
                  {formatMoney(whatsPrices[whatsPreset].price, "ARS")}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Ganancia: {formatMoney(whatsPrices[whatsPreset].gain, "ARS")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => copyToClipboard(whatsPrices[whatsPreset].price, setCopiedWhats)}
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2 h-11"
                >
                  {copiedWhats ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiedWhats ? "Copiado" : "Copiar"}
                </Button>
                <Button
                  onClick={() => { setActiveBreakdown(activeBreakdown === "whats" ? null : "whats"); setShowBreakdown(true); }}
                  variant={activeBreakdown === "whats" ? "default" : "outline"}
                  size="sm"
                  className="h-11 px-4"
                >
                  <TrendingUp className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Breakdown Panel */}
        {showBreakdown && (activeBreakdown === "ml" || activeBreakdown === "whats") && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Package className="h-4 w-4" />
                Breakdown {activeBreakdown === "ml" ? "Mercado Libre" : "WhatsApp"}
              </p>
              <button onClick={() => setShowBreakdown(false)} className="text-xs text-muted-foreground hover:text-foreground no-drag">
                Cerrar
              </button>
            </div>
            {activeBreakdown === "ml" && mlResult && (
              <div className="space-y-1.5 text-xs">
                <BreakdownRow label="Precio dealer" value={`USD ${mlResult.dealer_price_usd.toFixed(2)}`} />
                <BreakdownRow label="Peso" value={`${mlResult.weight_lbs} lbs = ${mlResult.weight_kg.toFixed(2)} kg`} />
                <BreakdownRow label="Surcharge flete" value={`+${mlResult.surcharge_kg.toFixed(2)} kg`} />
                <BreakdownRow label="Peso total" value={`${mlResult.total_weight_kg.toFixed(2)} kg`} />
                <div className="border-t border-border/60 pt-1.5 mt-1.5">
                  <BreakdownRow label="Derechos 21%" value={`USD ${mlResult.derechos_usd.toFixed(2)}`} />
                  <BreakdownRow label={`Flete (${mlResult.total_weight_kg.toFixed(2)}kg × $${SHIPPING_PER_KG})`} value={`USD ${mlResult.flete_usd.toFixed(2)}`} />
                  <BreakdownRow label="Handling" value={`USD ${mlResult.handling_usd.toFixed(2)}`} />
                  <BreakdownRow label="Costo total USD" value={`USD ${mlResult.costo_total_usd.toFixed(2)}`} bold />
                </div>
                <div className="border-t border-border/60 pt-1.5">
                  <BreakdownRow label={`Margin (${mlResult.margin_pct.toFixed(1)}%)`} value={`USD ${mlResult.costo_con_ganancia_usd.toFixed(2)}`} />
                  <BreakdownRow label="Conversión ARS" value={`USD × ${dollarValue}`} />
                  <BreakdownRow label="Neto desired" value={formatMoney(mlResult.neto_ars, "ARS")} />
                  <BreakdownRow label="IVA 21%" value={formatMoney(mlResult.iva_ars, "ARS")} />
                </div>
                <div className="border-t border-border/60 pt-1.5">
                  <BreakdownRow label="Comisión ML 24.2%" value={formatMoney(mlResult.comision_ml_ars, "ARS")} isNegative />
                  <BreakdownRow label="Bruto ARS" value={formatMoney(mlResult.precio_bruto_ars, "ARS")} />
                  <BreakdownRow label="Redondeo" value={`→ ${formatMoney(mlResult.precio_final_ars, "ARS")}`} bold />
                </div>
              </div>
            )}
            {activeBreakdown === "whats" && whatsResult && (
              <div className="space-y-1.5 text-xs">
                <BreakdownRow label="Precio dealer" value={`USD ${whatsResult.dealer_price_usd.toFixed(2)}`} />
                <BreakdownRow label="Peso" value={`${whatsResult.weight_lbs} lbs = ${whatsResult.weight_kg.toFixed(2)} kg`} />
                <BreakdownRow label="Surcharge flete" value={`+${whatsResult.surcharge_kg.toFixed(2)} kg`} />
                <BreakdownRow label="Peso total" value={`${whatsResult.total_weight_kg.toFixed(2)} kg`} />
                <div className="border-t border-border/60 pt-1.5 mt-1.5">
                  <BreakdownRow label="Derechos 21%" value={`USD ${whatsResult.derechos_usd.toFixed(2)}`} />
                  <BreakdownRow label={`Flete (${whatsResult.total_weight_kg.toFixed(2)}kg × $${SHIPPING_PER_KG})`} value={`USD ${whatsResult.flete_usd.toFixed(2)}`} />
                  <BreakdownRow label="Handling" value={`USD ${whatsResult.handling_usd.toFixed(2)}`} />
                  <BreakdownRow label="Costo total USD" value={`USD ${whatsResult.costo_total_usd.toFixed(2)}`} bold />
                </div>
                <div className="border-t border-border/60 pt-1.5">
                  <BreakdownRow label={`Margin (${whatsResult.margin_pct.toFixed(1)}%)`} value={`USD ${whatsResult.costo_con_ganancia_usd.toFixed(2)}`} />
                  <BreakdownRow label="Conversión ARS" value={`USD × ${dollarValue}`} />
                  <BreakdownRow label="Neto desired" value={formatMoney(whatsResult.neto_ars, "ARS")} />
                  <BreakdownRow label="IVA 21%" value={formatMoney(whatsResult.iva_ars, "ARS")} />
                </div>
                <div className="border-t border-border/60 pt-1.5">
                  <BreakdownRow label="Sin comisión ML" value="—" />
                  <BreakdownRow label="Bruto ARS" value={formatMoney(whatsResult.precio_bruto_ars, "ARS")} />
                  <BreakdownRow label="Redondeo" value={`→ ${formatMoney(whatsResult.precio_final_ars, "ARS")}`} bold />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {(!mlResult || !whatsResult) && dealerNum === 0 && lbsNum === 0 && (
          <div className="text-center py-10 text-sm text-muted-foreground">
            Ingresá precio dealer y peso para calcular
          </div>
        )}

        {/* Warning if partial */}
        {(dealerNum > 0 && lbsNum === 0) && (
          <div className="text-center py-4 text-sm text-muted-foreground">
            Falta ingresar el peso en libras
          </div>
        )}
        {(dealerNum === 0 && lbsNum > 0) && (
          <div className="text-center py-4 text-sm text-muted-foreground">
            Falta ingresar el precio dealer
          </div>
        )}
      </div>
    </>
  );

  function BreakdownRow({ label, value, bold, isNegative }: { label: string; value: string; bold?: boolean; isNegative?: boolean }) {
    return (
      <div className="flex justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-mono", bold && "font-semibold", isNegative && "text-destructive")}>{value}</span>
      </div>
    );
  }

  if (isFloating) {
    return (
      <div
        className="fixed inset-0 pointer-events-none z-40"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          className="pointer-events-auto absolute bg-background rounded-xl border shadow-2xl w-[800px] max-w-[95vw]"
          style={{ left: position.x, top: position.y }}
        >
          {mainContent}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 max-w-4xl bg-background rounded-xl border shadow-sm">
      {mainContent}
    </div>
  );
}
