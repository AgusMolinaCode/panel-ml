"use client";

import * as React from "react";
import { DateRange } from "react-day-picker";
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, subDays, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { cn } from "@/lib/utils";

export interface DateRangeValue {
  from: Date;
  to: Date;
}

type PresetKey =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "thisMonth"
  | "lastMonth"
  | "firstHalfLastMonth"
  | "secondHalfLastMonth"
  | "firstHalfThisMonth"
  | "secondHalfThisMonth"
  | "custom";

interface Preset {
  key: PresetKey;
  label: string;
  resolve: () => DateRangeValue;
}

const PRESETS: Preset[] = [
  { key: "today", label: "Hoy", resolve: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { key: "yesterday", label: "Ayer", resolve: () => { const y = subDays(new Date(), 1); return { from: startOfDay(y), to: endOfDay(y) }; } },
  { key: "last7", label: "Últimos 7 días", resolve: () => ({ from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) }) },
  { key: "last30", label: "Últimos 30 días", resolve: () => ({ from: startOfDay(subDays(new Date(), 29)), to: endOfDay(new Date()) }) },
  { key: "thisMonth", label: "Este mes", resolve: () => ({ from: startOfMonth(new Date()), to: endOfDay(new Date()) }) },
  { key: "lastMonth", label: "Mes pasado", resolve: () => { const lm = subMonths(new Date(), 1); return { from: startOfMonth(lm), to: endOfMonth(lm) }; } },
  { key: "firstHalfLastMonth", label: "1ra quincena mes pasado", resolve: () => { const lm = subMonths(new Date(), 1); return { from: startOfMonth(lm), to: endOfDay(new Date(lm.getFullYear(), lm.getMonth(), 15)) }; } },
  { key: "secondHalfLastMonth", label: "2da quincena mes pasado", resolve: () => { const lm = subMonths(new Date(), 1); return { from: startOfDay(new Date(lm.getFullYear(), lm.getMonth(), 16)), to: endOfMonth(lm) }; } },
  { key: "firstHalfThisMonth", label: "1ra quincena este mes", resolve: () => { const n = new Date(); return { from: startOfMonth(n), to: endOfDay(new Date(n.getFullYear(), n.getMonth(), 15)) }; } },
  { key: "secondHalfThisMonth", label: "2da quincena este mes", resolve: () => { const n = new Date(); return { from: startOfDay(new Date(n.getFullYear(), n.getMonth(), 16)), to: endOfDay(n) }; } },
  { key: "custom", label: "Personalizado…", resolve: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
];

interface Props {
  value: DateRangeValue;
  onChange: (range: DateRangeValue) => void;
  className?: string;
}

export function DateRangePicker({ value, onChange, className }: Props) {
  const [preset, setPreset] = React.useState<PresetKey>("last30");
  const [open, setOpen] = React.useState(false);

  function applyPreset(key: PresetKey): void {
    setPreset(key);
    if (key === "custom") return;
    const found = PRESETS.find((p) => p.key === key);
    if (found) onChange(found.resolve());
  }

  function handleCalendarSelect(range: DateRange | undefined): void {
    if (!range?.from) return;
    if (range.to) {
      onChange({ from: startOfDay(range.from), to: endOfDay(range.to) });
      setPreset("custom");
    } else {
      onChange({ from: startOfDay(range.from), to: endOfDay(range.from) });
    }
  }

  const display = `${format(value.from, "dd/MM/yyyy", { locale: es })} – ${format(
    value.to,
    "dd/MM/yyyy",
    { locale: es }
  )}`;
  const presetLabel = PRESETS.find((p) => p.key === preset)?.label ?? "Personalizado";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Select value={preset} onValueChange={(v) => applyPreset(v as PresetKey)}>
        <SelectTrigger className="w-[200px]">
          <SelectValue>{presetLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.key} value={p.key}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="md"
            className="min-w-[260px] justify-start text-left font-normal"
            onClick={() => {
              setPreset("custom");
              setOpen(true);
            }}
          >
            <CalendarIcon className="h-4 w-4" />
            {display}
            <ChevronDown className="ml-auto h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={{ from: value.from, to: value.to }}
            onSelect={handleCalendarSelect}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}