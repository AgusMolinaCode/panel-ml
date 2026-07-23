"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

/**
 * Thin shadcn-style chart container. Recharts itself doesn't need a wrapper,
 * but we use this to enforce a min-height + width for ResponsiveContainer.
 */
interface ChartContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Configured height in px. Recharts ResponsiveContainer needs a height. */
  height?: number;
}

export const ChartContainer = React.forwardRef<HTMLDivElement, ChartContainerProps>(
  ({ children, height = 300, className, ...rest }, ref) => (
    <div ref={ref} className={cn("w-full", className)} style={{ height }} {...rest}>
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  )
);
ChartContainer.displayName = "ChartContainer";

/** shadcn-style chart tooltip wrapper (uses Recharts default tooltip). */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string | number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatter?: (value: any, name: any) => [string, string];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      {label !== undefined && (
        <div className="mb-1 font-medium">{label}</div>
      )}
      <div className="space-y-0.5">
        {payload.map((entry, i: number) => {
          const [name, value] = formatter
            ? formatter(entry.value, entry.name)
            : [entry.name, String(entry.value)];
          return (
            <div key={i} className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: entry.color ?? entry.fill }}
              />
              <span className="text-muted-foreground">{name}:</span>
              <span className="font-medium tabular-nums">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}