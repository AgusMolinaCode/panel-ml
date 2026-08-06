"use client";

import * as React from "react";
import { Calculator, Copy, Check, RefreshCw, MessageCircle, GripVertical, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { formatMoney } from "@/lib/format";
import {
  breakdownMLMonthlyFee,
  SHIPPING_COST_PER_KG,
  LBS_TO_KG,
  type MLPriceBreakdown,
} from "@/lib/price";
import { cn } from "@/lib/utils";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";

const WHATS_MARGIN = 0.63; // 63% margen sobre precio dealer (sin flete, sin handling)
const WHATS_TOTAL_MULTIPLIER = 1.63; // incluye derechos 21% + IVA 21% + margen 63%

interface WhatsPriceBreakdown {
  dealer_price_usd: number;
  peso_usd: number;
  derechos_usd: number;
  costo_total_usd: number;
  margen_usd: number;
  dollar_rate: number;
  precio_final_ars: number;
}

function calculateWhatsResult(
  dealerPrice: number,
  dollarRate: number,
  multiplier = 1
): WhatsPriceBreakdown {
  // Fórmula simple: (precio dealer) * 1.63 * dolar
  // Incluye: derechos 21% + IVA 21% + margen 63% (el 0.63)
  // Sin flete (lo absorbe el cliente), sin handling
  const costoTotalUsd = dealerPrice;
  const margenUsd = costoTotalUsd * WHATS_MARGIN * multiplier;
  const precioFinalArs = (costoTotalUsd + margenUsd) * dollarRate;

  return {
    dealer_price_usd: dealerPrice,
    peso_usd: 0,
    derechos_usd: dealerPrice * 0.21,
    costo_total_usd: costoTotalUsd,
    margen_usd: margenUsd,
    dollar_rate: dollarRate,
    precio_final_ars: precioFinalArs,
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
    ? breakdownMLMonthlyFee(dealerNum, lbsNum, dollarValue)
    : null;

  const whatsResult = dealerNum > 0 && dollarValue > 0
    ? calculateWhatsResult(dealerNum, dollarValue)
    : null;

  // Ganancia REAL neta ML: coincide con el modelo de lib/pricing.ts
  const netGainMl = (r: MLPriceBreakdown): number =>
    r.neto_final_ars - r.costo_total_usd * dollarValue;

  // WhatsApp: precio simple = dealerPrice * 1.63 * dolar
  // ganancia = dealerPrice * 0.63 * dolar * multiplier
  const whatsPrices = WHATS_PRESETS.map(p => {
    const margenUsd = dealerNum * WHATS_MARGIN * p.multiplier;
    const precio = (dealerNum + margenUsd) * dollarValue;
    const gain = margenUsd * dollarValue;
    return {
      ...p,
      price: precio,
      gain: gain,
    };
  });

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
        {mlResult && (
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
                {formatMoney(mlResult.final_price_ars, "ARS")}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Ganancia: {formatMoney(netGainMl(mlResult), "ARS")}
              </p>
            </div>
            <Button
              onClick={() => copyToClipboard(mlResult.final_price_ars, setCopiedMl)}
              variant="outline"
              size="sm"
              className="w-full gap-2 h-11"
            >
              {copiedMl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiedMl ? "Copiado" : "Copiar"}
            </Button>

            <Accordion>
              <AccordionItem value="ml">
                <AccordionTrigger value="ml">Ver desglose de la cuenta</AccordionTrigger>
                <AccordionContent value="ml">
                  <div className="space-y-1.5 text-xs">
                    <BreakdownRow label="Precio dealer" value={`USD ${mlResult.dealer_price_usd.toFixed(2)}`} />
                    <BreakdownRow label="Peso usado" value={`${mlResult.weight_kg_used.toFixed(2)} kg (surcharge +${mlResult.surcharge_kg.toFixed(2)} kg)`} />
                    <div className="border-t border-border/60 pt-1.5 mt-1.5">
                      <BreakdownRow label="Derechos 21%" value={`USD ${mlResult.derechos_estadistica_usd.toFixed(2)}`} />
                      <BreakdownRow label={`Flete (${mlResult.weight_kg_used.toFixed(2)}kg × $${SHIPPING_COST_PER_KG})`} value={`USD ${mlResult.flete_usd.toFixed(2)}`} />
                      <BreakdownRow label="Costo total USD" value={`USD ${mlResult.costo_total_usd.toFixed(2)}`} bold />
                    </div>
                    <div className="border-t border-border/60 pt-1.5">
                      <BreakdownRow label={`Margin (${mlResult.margin_applied_pct.toFixed(1)}%)`} value={`USD ${mlResult.costo_con_ganancia_usd.toFixed(2)}`} />
                      <BreakdownRow label="Conversión ARS" value={`USD × ${dollarValue}`} />
                    </div>
                    <div className="border-t border-border/60 pt-1.5">
                      <BreakdownRow label="Fracción retenida" value={`${(mlResult.retained_fraction * 100).toFixed(2)}%`} />
                      <BreakdownRow label="IVA débito" value={formatMoney(mlResult.iva_debito_ars, "ARS")} isNegative />
                      <BreakdownRow label="Comisión ML 24.2%" value={formatMoney(mlResult.comision_ml_ars, "ARS")} isNegative />
                      <BreakdownRow label="Percep. s/comisión 3%" value={formatMoney(mlResult.percep_comision_ars, "ARS")} isNegative />
                      <BreakdownRow label="Cuotas 6%" value={formatMoney(mlResult.cuotas_ars, "ARS")} isNegative />
                      <BreakdownRow label="Percep. IVA 1%" value={formatMoney(mlResult.percep_iva_ars, "ARS")} isNegative />
                      <BreakdownRow label="IIBB 0.25%" value={formatMoney(mlResult.iibb_ars, "ARS")} isNegative />
                    </div>
                    <div className="border-t border-border/60 pt-1.5">
                      <BreakdownRow label="Envío ML" value={formatMoney(mlResult.envio_ml_ars, "ARS")} isNegative />
                      <BreakdownRow label="Precio final" value={formatMoney(mlResult.final_price_ars, "ARS")} bold />
                    </div>
                    <div className="border-t border-border/60 pt-1.5">
                      <BreakdownRow label="Neto final (post-ML)" value={formatMoney(mlResult.neto_final_ars, "ARS")} />
                      <BreakdownRow label="Ganancia estimada" value={formatMoney(netGainMl(mlResult), "ARS")} />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}

        {whatsResult && (
          <div className="rounded-xl border-2 border-green-500/20 bg-green-500/5 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
                  <MessageCircle className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-base font-bold">WhatsApp</p>
                  <p className="text-xs text-muted-foreground">Sin comision ML · margen base</p>
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
            <Button
              onClick={() => copyToClipboard(whatsPrices[whatsPreset].price, setCopiedWhats)}
              variant="outline"
              size="sm"
              className="w-full gap-2 h-11"
            >
              {copiedWhats ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiedWhats ? "Copiado" : "Copiar"}
            </Button>

            <Accordion>
              <AccordionItem value="whats">
                <AccordionTrigger value="whats">Ver desglose de la cuenta</AccordionTrigger>
                <AccordionContent value="whats">
                  <div className="space-y-1.5 text-xs">
                    <BreakdownRow label="Precio dealer USD" value={`USD ${whatsResult.dealer_price_usd.toFixed(2)}`} />
                    <BreakdownRow label="Derechos 21%" value={`USD ${whatsResult.derechos_usd.toFixed(2)}`} />
                    <div className="border-t border-border/60 pt-1.5 mt-1.5">
                      <BreakdownRow label="Margen 63%" value={`USD ${whatsResult.margen_usd.toFixed(2)}`} />
                      <BreakdownRow label="Conversión" value={`USD × ${dollarValue}`} />
                    </div>
                    <div className="border-t border-border/60 pt-1.5">
                      <BreakdownRow label="Precio final" value={formatMoney(whatsResult.precio_final_ars, "ARS")} bold />
                      <BreakdownRow label="Ganancia" value={formatMoney(whatsResult.margen_usd * dollarValue, "ARS")} />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}

        {/* Empty state */}
        {!mlResult && !whatsResult && dealerNum === 0 && (
          <div className="text-center py-10 text-sm text-muted-foreground">
            Ingresá precio dealer y peso para calcular
          </div>
        )}

        {/* Warning if partial ML */}
        {dealerNum > 0 && !mlResult && (
          <div className="text-center py-4 text-sm text-muted-foreground">
            Falta ingresar el peso en libras para calcular ML
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
