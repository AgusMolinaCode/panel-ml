"use client";

import * as React from "react";
import { Plus, Trash2, Wallet } from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getRangeFromMode } from "./monthly-gains-grid";

interface Expense {
  id: string;
  concepto: string;
  monto: number;
}

type Order = {
  id: number;
  total_amount: number;
  sale_fee: number | null;
  status: string;
  date_created: number;
};

type CostData = {
  order_id: number;
  cost: number;
  gain: number | null;
  ml_envio: number | null;
  ml_fee_pct: number;
};

const MONTH_NAMES: Record<string, string> = {
  "01": "Enero",
  "02": "Febrero",
  "03": "Marzo",
  "04": "Abril",
  "05": "Mayo",
  "06": "Junio",
  "07": "Julio",
  "08": "Agosto",
  "09": "Septiembre",
  "10": "Octubre",
  "11": "Noviembre",
  "12": "Diciembre",
};

function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getPreviousMonthKey(monthStr: string): string {
  const [year, month] = monthStr.split("-").map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(monthStr: string): string {
  const [year, m] = monthStr.split("-");
  const name = MONTH_NAMES[m] ?? m;
  return `${name} ${year}`;
}

function navigateMonth(monthStr: string, direction: "prev" | "next"): string {
  const [year, month] = monthStr.split("-").map(Number);
  const offset = direction === "next" ? 1 : -1;
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthlyExpenses() {
  const [monthKey, setMonthKey] = React.useState<string>(getCurrentMonthKey);
  const { fromMs, toMs } = getRangeFromMode("month");

  const [expenses, setExpenses] = React.useState<Expense[]>([]);
  const [monthlyGain, setMonthlyGain] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchExpenses = React.useCallback(async () => {
    const res = await fetch(`/api/expenses?month=${monthKey}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = (await res.json()) as { expenses: Expense[] };
    return data.expenses ?? [];
  }, [monthKey]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const loaded = await fetchExpenses();
        if (cancelled) return;
        setExpenses(loaded);
      } catch (err) {
        console.error("Failed to load expenses:", err);
        if (!cancelled) setExpenses([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchExpenses]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const allOrders: Order[] = [];
        let offset = 0;
        const limit = 100;
        const statuses = ["paid", "confirmed", "partially_paid"];

        while (!cancelled) {
          const params = new URLSearchParams({
            from: String(fromMs),
            to: String(toMs),
            limit: String(limit),
            offset: String(offset),
          });
          for (const s of statuses) params.append("status", s);
          const res = await fetch(`/api/orders?${params.toString()}`);
          const json = (await res.json()) as { orders: Order[]; total: number };
          if (!json.orders?.length) break;
          allOrders.push(...json.orders);
          if (allOrders.length >= json.total) break;
          offset += limit;
        }

        if (cancelled || !allOrders.length) {
          if (!cancelled) setMonthlyGain(0);
          setLoading(false);
          return;
        }

        const orderIds = allOrders.map((o) => o.id);
        const costsRes = await fetch(`/api/orders/costs?ids=${orderIds.join(",")}`);
        const costsData = (await costsRes.json()) as Record<number, CostData>;

        const monthGainMap = new Map<string, number>();
        for (const order of allOrders) {
          const cost = costsData[order.id];
          const totalAmount = Number(order.total_amount) || 0;
          const saleFee = order.sale_fee ?? totalAmount * 0.19;
          const envio = cost?.ml_envio ?? 0;
          const iibb = totalAmount * 0.0025;
          const netSale = totalAmount - saleFee - envio - iibb;
          const calculatedGain = netSale - (cost?.cost ?? 0);
          const gain = cost?.gain != null ? cost.gain : cost ? calculatedGain : null;

          const monthStr = new Date(Number(order.date_created) || 0).toISOString().slice(0, 7);
          if (!monthGainMap.has(monthStr)) monthGainMap.set(monthStr, 0);
          if (gain != null) monthGainMap.set(monthStr, (monthGainMap.get(monthStr) ?? 0) + gain);
        }

        if (!cancelled) setMonthlyGain(monthGainMap.get(monthKey) ?? 0);
      } catch (err) {
        console.error("Failed to load monthly gain:", err);
        if (!cancelled) setMonthlyGain(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fromMs, toMs, monthKey]);

  const totalExpenses = expenses.reduce((sum, e) => sum + e.monto, 0);
  const pocketMoney = (monthlyGain ?? 0) - totalExpenses;

  async function saveExpense(expense: Expense): Promise<void> {
    try {
      const res = await fetch(`/api/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...expense, month: monthKey }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const listRes = await fetch(`/api/expenses?month=${monthKey}`);
      if (!listRes.ok) throw new Error(`Failed to reload expenses`);
      const listData = (await listRes.json()) as { expenses: Expense[] };
      setExpenses(listData.expenses ?? []);
    } catch (err) {
      console.error("Failed to save expense:", err);
    }
  }

  function addExpense(): void {
    const newExpense: Expense = {
      id: crypto.randomUUID(),
      concepto: "",
      monto: 0,
    };
    setExpenses((prev) => [...prev, newExpense]);
    void saveExpense(newExpense);
  }

  function updateExpense(id: string, field: keyof Expense, value: string | number): void {
    const updated = expenses.map((e) =>
      e.id === id ? { ...e, [field]: value } : e
    );
    setExpenses(updated);
    const expense = updated.find((e) => e.id === id);
    if (expense) void saveExpense(expense);
  }

  function deleteExpense(id: string): void {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    void (async () => {
      try {
        const res = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`API error ${res.status}`);
      } catch (err) {
        console.error("Failed to delete expense:", err);
      }
    })();
  }

  if (loading) {
    return (
      <div className="h-48 animate-pulse rounded-xl bg-muted" />
    );
  }

  return (
    <Card className="mt-4">
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Wallet className="h-3.5 w-3.5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                Gastos Fijos — {formatMonth(monthKey)}
              </h3>
              <p className="text-xs text-muted-foreground">
                Registrá tus gastos mensuales fijos
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMonthKey((m) => navigateMonth(m, "prev"))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-muted transition-colors text-xs"
              title="Mes anterior"
            >
              ‹
            </button>
            <button
              onClick={() => setMonthKey(getCurrentMonthKey)}
              className="flex h-7 items-center justify-center px-2 rounded-md border border-border hover:bg-muted transition-colors text-xs"
            >
              Hoy
            </button>
            <button
              onClick={() => setMonthKey((m) => navigateMonth(m, "next"))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-muted transition-colors text-xs"
              title="Mes siguiente"
            >
              ›
            </button>
            {expenses.length === 0 && (
              <CloneButton monthKey={monthKey} onCloned={() => fetchExpenses().then(setExpenses)} />
            )}
          </div>
        </div>
      </div>

        <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-muted/40">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[60%]">CONCEPTO</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground w-[40%]">MONTO</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((expense) => (
              <ExpenseRow
                key={expense.id}
                expense={expense}
                onUpdate={updateExpense}
                onDelete={deleteExpense}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-border/60">
        <Button onClick={addExpense} size="sm" variant="outline" className="text-xs h-7 gap-1">
          <Plus className="h-3 w-3" />
          Agregar gasto
        </Button>
        {expenses.length === 0 && (
          <span className="text-xs text-muted-foreground mr-auto ml-4">
            Sin gastos registrados
          </span>
        )}
      </div>

      {/* Summary */}
      <div className="border-t border-border/60 bg-muted/30 px-4 py-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Ganancia neta {formatMonth(monthKey)}</span>
          <span className={cn(
            "tabular-nums font-medium",
            (monthlyGain ?? 0) >= 0 ? "text-success" : "text-destructive"
          )}>
            {monthlyGain != null ? formatMoney(monthlyGain, "ARS") : "—"}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Total gastos</span>
          <span className="tabular-nums font-medium text-destructive">
            − {formatMoney(totalExpenses, "ARS")}
          </span>
        </div>
        <div className="flex justify-between text-xs border-t border-border/60 pt-1.5">
          <span className="font-medium">En tu bolsillo</span>
          <span
            className={cn(
              "tabular-nums font-bold text-sm",
              pocketMoney >= 0 ? "text-success" : "text-destructive"
            )}
          >
            {pocketMoney >= 0 ? "+" : ""}{formatMoney(pocketMoney, "ARS")}
          </span>
        </div>
      </div>
    </Card>
  );
}

function ExpenseRow({
  expense,
  onUpdate,
  onDelete,
}: {
  expense: Expense;
  onUpdate: (id: string, field: keyof Expense, value: string | number) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <tr className="border-b border-border/40 group">
      <td className="px-3 py-1.5">
        <input
          type="text"
          value={expense.concepto}
          onChange={(e) => onUpdate(expense.id, "concepto", e.target.value)}
          placeholder="Nombre del gasto"
          className="w-full bg-transparent text-xs border-none outline-none focus:ring-0 placeholder:text-muted-foreground/50"
        />
      </td>
      <td className="px-3 py-1.5">
        <input
          type="number"
          value={expense.monto || ""}
          onChange={(e) => onUpdate(expense.id, "monto", parseFloat(e.target.value) || 0)}
          placeholder="0"
          className="w-full bg-transparent text-xs text-right tabular-nums border-none outline-none focus:ring-0 placeholder:text-muted-foreground/50"
        />
      </td>
      <td className="px-2 py-1.5">
        <button
          type="button"
          onClick={() => onDelete(expense.id)}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </td>
    </tr>
  );
}

function CloneButton({
  monthKey,
  onCloned,
}: {
  monthKey: string;
  onCloned: () => void;
}) {
  const prev = getPreviousMonthKey(monthKey);
  const prevMonthName = MONTH_NAMES[prev.split("-")[1]] ?? prev.split("-")[1];

  return (
    <button
      onClick={() => {
        void (async () => {
          try {
            const res = await fetch(`/api/expenses`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cloneFrom: prev, cloneTo: monthKey }),
            });
            if (!res.ok) throw new Error(`API error ${res.status}`);
            onCloned();
          } catch (err) {
            console.error("Failed to clone expenses:", err);
          }
        })();
      }}
      className="flex h-7 items-center justify-center px-2 rounded-md bg-primary/10 hover:bg-primary/20 text-primary transition-colors text-xs font-medium"
    >
      + Clonar de {prevMonthName}
    </button>
  );
}
