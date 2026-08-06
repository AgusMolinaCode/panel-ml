"use client";

import * as React from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { formatMoney } from "@/lib/format";
import { Calculator, AlertCircle, Receipt, ArrowRight, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface IvaSummaryData {
  month: string;
  local: {
    orderCount: number;
    ordersWithCost: number;
    totalSales: number;
    ivaDebito: number;
    ivaCreditoImportacion: number;
    ivaCreditoComisionesML: number;
    ivaCreditoEnvioML: number;
    ivaCreditoCourier: number;
    ivaCreditoFiscalTotal: number;
    ivaAAbonar: number;
  };
  projection: {
    projectedIvaDebito: number;
    projectedIvaAAbonar: number;
    daysElapsed: number;
    daysInMonth: number;
  } | null;
}

function getMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    options.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return options;
}

function Row({ label, value, negative, bold }: { label: string; value: string; negative?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono tabular-nums", bold && "font-semibold", negative && "text-destructive")}>
        {value}
      </span>
    </div>
  );
}

export function MonthlyIvaSummary() {
  const [selectedMonth, setSelectedMonth] = React.useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [data, setData] = React.useState<IvaSummaryData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchSummary = React.useCallback(async () => {
    const [year, month] = selectedMonth.split("-");
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/iva-summary?year=${year}&month=${month}`);
      const json = (await res.json()) as IvaSummaryData | { error: string };
      if (!res.ok) {
        setError("error" in json ? json.error : `Error ${res.status}`);
        setData(null);
      } else {
        setData(json as IvaSummaryData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  React.useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  const monthOptions = React.useMemo(getMonthOptions, []);
  const isCurrentMonth = selectedMonth === monthOptions[0]?.value;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold">Estimación de IVA a pagar</h3>
            <p className="text-xs text-muted-foreground">
              Cálculo mensual basado en las ventas y costos cargados en el panel
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-[180px] h-9 text-xs">
              <SelectValue placeholder="Seleccionar mes" />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9" onClick={() => void fetchSummary()} disabled={loading}>
            Actualizar
          </Button>
        </div>
      </div>

      {isCurrentMonth && (
        <p className="text-xs text-muted-foreground">
          Proyección lineal al cierre del mes según lo facturado hasta hoy.
        </p>
      )}

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="h-48 animate-pulse bg-muted"><div /></Card>
          ))}
        </div>
      )}

      {error && !loading && (
        <Card className="p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">No se pudo calcular el IVA</p>
              <p className="text-xs text-destructive/80 mt-1">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {!loading && !error && data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* IVA Débito */}
            <Card className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-semibold">IVA Débito</h4>
              </div>
              <div>
                <p className="text-2xl font-black font-mono text-destructive">
                  {formatMoney(data.local.ivaDebito, "ARS")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.local.orderCount} órdenes · {formatMoney(data.local.totalSales, "ARS")} en ventas
                </p>
              </div>
              <div className="space-y-1 pt-2 border-t border-border/60">
                <Row label="Alícuota" value="21%" />
                <Row label="Base imponible" value={formatMoney(data.local.totalSales / 1.21, "ARS")} />
              </div>
              {data.projection && (
                <div className="pt-2 border-t border-dashed border-border/60">
                  <p className="text-xs text-muted-foreground">Proyección al cierre</p>
                  <p className="text-lg font-bold font-mono text-destructive">
                    {formatMoney(data.projection.projectedIvaDebito, "ARS")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Día {data.projection.daysElapsed} de {data.projection.daysInMonth}
                  </p>
                </div>
              )}
            </Card>

            {/* IVA Crédito Fiscal */}
            <Card className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-semibold">IVA Crédito Fiscal</h4>
              </div>
              <div>
                <p className={cn("text-2xl font-black font-mono", data.local.ivaCreditoFiscalTotal > 0 ? "text-success" : "text-muted-foreground")}>
                  {formatMoney(data.local.ivaCreditoFiscalTotal, "ARS")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.local.ordersWithCost} de {data.local.orderCount} órdenes con costos
                </p>
              </div>
              <div className="space-y-1 pt-2 border-t border-border/60">
                <Row label="Importación / derechos" value={formatMoney(data.local.ivaCreditoImportacion, "ARS")} />
                <Row label="Comisiones ML" value={formatMoney(data.local.ivaCreditoComisionesML, "ARS")} />
                <Row label="Envío ML" value={formatMoney(data.local.ivaCreditoEnvioML, "ARS")} />
                <Row label="Flete/courier" value={formatMoney(data.local.ivaCreditoCourier, "ARS")} />
              </div>
            </Card>

            {/* Saldo a abonar */}
            <Card className={cn("p-5 space-y-4 border-2", data.local.ivaAAbonar >= 0 ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5")}>
              <div className="flex items-center gap-2">
                <ArrowRight className={cn("h-4 w-4", data.local.ivaAAbonar >= 0 ? "text-destructive" : "text-success")} />
                <h4 className="text-sm font-semibold">IVA a abonar</h4>
              </div>
              <div>
                <p className={cn("text-2xl font-black font-mono", data.local.ivaAAbonar >= 0 ? "text-destructive" : "text-success")}>
                  {formatMoney(Math.abs(data.local.ivaAAbonar), "ARS")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.local.ivaAAbonar >= 0
                    ? "Saldo estimado a pagar a AFIP"
                    : "Saldo estimado a favor"}
                </p>
              </div>
              <div className="space-y-1 pt-2 border-t border-border/60">
                <Row label="Débito" value={formatMoney(data.local.ivaDebito, "ARS")} />
                <Row label="Crédito" value={formatMoney(data.local.ivaCreditoFiscalTotal, "ARS")} negative />
                <Row label="Resultado" value={formatMoney(data.local.ivaAAbonar, "ARS")} bold />
              </div>
              {data.projection && (
                <div className="pt-2 border-t border-dashed border-border/60">
                  <p className="text-xs text-muted-foreground">Proyección al cierre</p>
                  <p className={cn("text-lg font-bold font-mono", data.projection.projectedIvaAAbonar >= 0 ? "text-destructive" : "text-success")}>
                    {formatMoney(Math.abs(data.projection.projectedIvaAAbonar), "ARS")}
                  </p>
                </div>
              )}
            </Card>
          </div>

          {data.local.ordersWithCost === 0 && data.local.orderCount > 0 && (
            <Card className="p-4 bg-warning/5 border-warning/30">
              <div className="flex items-start gap-2 text-xs text-warning">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  No hay costos cargados para las órdenes de este mes. El crédito fiscal está en 0,
                  por lo que el IVA a abonar se calcula sobre el débito total. Cargá los costos en
                  el detalle de cada orden para una estimación precisa.
                </span>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
