"use client";

import * as React from "react";
import { Plus, Trash2, Wrench } from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

interface RepairOrder {
  id: string;
  month: string;
  date: number;
  description: string;
  amount: number;
}

const MONTH_NAMES: Record<string, string> = {
  "01": "Enero", "02": "Febrero", "03": "Marzo",
  "04": "Abril", "05": "Mayo", "06": "Junio",
  "07": "Julio", "08": "Agosto", "09": "Septiembre",
  "10": "Octubre", "11": "Noviembre", "12": "Diciembre",
};

function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(monthStr: string): string {
  const [year, m] = monthStr.split("-");
  return `${MONTH_NAMES[m] ?? m} ${year}`;
}

function navigateMonth(monthStr: string, direction: "prev" | "next"): string {
  const [year, month] = monthStr.split("-").map(Number);
  const offset = direction === "next" ? 1 : -1;
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

interface Props {
  monthKey: string;
  onMonthChange: (month: string) => void;
  onIncomeChange?: (total: number) => void;
}

export function RepairsLog({ monthKey, onMonthChange, onIncomeChange }: Props) {
  const [repairs, setRepairs] = React.useState<RepairOrder[]>([]);
  const [loading, setLoading] = React.useState(true);

  const fetchRepairs = React.useCallback(async () => {
    const res = await fetch(`/api/repairs?month=${monthKey}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = (await res.json()) as { repairs: RepairOrder[] };
    return data.repairs ?? [];
  }, [monthKey]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const loaded = await fetchRepairs();
        if (!cancelled) setRepairs(loaded);
      } catch (err) {
        console.error("Failed to load repairs:", err);
        if (!cancelled) setRepairs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchRepairs]);

  // Notify parent of total repair income
  React.useEffect(() => {
    const total = repairs.reduce((sum, r) => sum + r.amount, 0);
    onIncomeChange?.(total);
  }, [repairs, onIncomeChange]);

  // Debounce save to avoid race conditions on rapid keystrokes
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  async function saveRepair(repair: RepairOrder): Promise<void> {
    try {
      const res = await fetch("/api/repairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...repair, month: monthKey }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
    } catch (err) {
      console.error("Failed to save repair:", err);
    }
  }

  function debouncedSave(repair: RepairOrder): void {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveRepair(repair);
    }, 300);
  }

  function addRepair(): void {
    const newRepair: RepairOrder = {
      id: crypto.randomUUID(),
      month: monthKey,
      date: Date.now(),
      description: "",
      amount: 0,
    };
    setRepairs((prev) => [newRepair, ...prev]);
    void saveRepair(newRepair);
  }

  function updateRepair(id: string, field: keyof RepairOrder, value: string | number): void {
    const updated = repairs.map((r) =>
      r.id === id ? { ...r, [field]: value } : r
    );
    setRepairs(updated);
    const repair = updated.find((r) => r.id === id);
    if (repair) debouncedSave(repair);
  }

  function deleteRepairById(id: string): void {
    setRepairs((prev) => prev.filter((r) => r.id !== id));
    void (async () => {
      try {
        const res = await fetch(`/api/repairs?id=${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`API error ${res.status}`);
      } catch (err) {
        console.error("Failed to delete repair:", err);
      }
    })();
  }

  const totalIncome = repairs.reduce((sum, r) => sum + r.amount, 0);

  if (loading) {
    return (
      <div className="h-32 animate-pulse rounded-xl bg-muted" />
    );
  }

  return (
    <Card className="mt-4">
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-success/10 text-success">
              <Wrench className="h-3.5 w-3.5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                Reparaciones — {formatMonth(monthKey)}
              </h3>
              <p className="text-xs text-muted-foreground">
                Ingreso por servicio de reparaciones
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onMonthChange(navigateMonth(monthKey, "prev"))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-muted transition-colors text-xs"
              title="Mes anterior"
            >
              ‹
            </button>
            <span className="text-xs text-muted-foreground min-w-[80px] text-center">
              {formatMonth(monthKey)}
            </span>
            <button
              onClick={() => onMonthChange(navigateMonth(monthKey, "next"))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-muted transition-colors text-xs"
              title="Mes siguiente"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-muted/40">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[35%]">FECHA</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[45%]">DESCRIPCIÓN</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground w-[15%]">MONTO</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {repairs.map((repair) => (
              <RepairRow
                key={repair.id}
                repair={repair}
                onUpdate={updateRepair}
                onDelete={deleteRepairById}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-border/60">
        <Button onClick={addRepair} size="sm" variant="outline" className="text-xs h-7 gap-1">
          <Plus className="h-3 w-3" />
          Agregar reparación
        </Button>
        {repairs.length === 0 && (
          <span className="text-xs text-muted-foreground mr-auto ml-4">
            Sin reparaciones este mes
          </span>
        )}
      </div>

      {totalIncome > 0 && (
        <div className="border-t border-border/60 bg-success/5 px-4 py-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Total ingresos por reparaciones</span>
            <span className="tabular-nums font-bold text-success">
              + {formatMoney(totalIncome, "ARS")}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

function RepairRow({
  repair,
  onUpdate,
  onDelete,
}: {
  repair: RepairOrder;
  onUpdate: (id: string, field: keyof RepairOrder, value: string | number) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <tr className="border-b border-border/40 group">
      <td className="px-3 py-1.5">
        <input
          type="date"
          value={new Date(repair.date).toISOString().split("T")[0]}
          onChange={(e) => onUpdate(repair.id, "date", new Date(e.target.value).getTime())}
          className="w-full bg-transparent text-xs border-none outline-none focus:ring-0"
        />
      </td>
      <td className="px-3 py-1.5">
        <input
          type="text"
          value={repair.description}
          onChange={(e) => onUpdate(repair.id, "description", e.target.value)}
          placeholder="Descripción del trabajo"
          className="w-full bg-transparent text-xs border-none outline-none focus:ring-0 placeholder:text-muted-foreground/50"
        />
      </td>
      <td className="px-3 py-1.5">
        <input
          type="number"
          value={repair.amount || ""}
          onChange={(e) => onUpdate(repair.id, "amount", parseFloat(e.target.value) || 0)}
          placeholder="0"
          className="w-full bg-transparent text-xs text-right tabular-nums border-none outline-none focus:ring-0 placeholder:text-muted-foreground/50"
        />
      </td>
      <td className="px-2 py-1.5">
        <button
          type="button"
          onClick={() => onDelete(repair.id)}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </td>
    </tr>
  );
}
