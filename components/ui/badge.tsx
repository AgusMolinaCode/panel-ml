import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        default: "bg-muted text-muted-foreground",
        success:
          "bg-success/10 text-success border border-success/20",
        warning:
          "bg-warning/10 text-warning border border-warning/20",
        danger:
          "bg-destructive/10 text-destructive border border-destructive/20",
        info: "bg-info/10 text-info border border-info/20",
        primary:
          "bg-primary/10 text-primary border border-primary/20",
      },
    },
    defaultVariants: { tone: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Render a small colored dot before the children. */
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({ className, tone, dot, children, ...rest }) => {
  const dotColor: Record<NonNullable<typeof tone>, string> = {
    default: "bg-muted-foreground",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-destructive",
    info: "bg-info",
    primary: "bg-primary",
  };
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...rest}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotColor[tone ?? "default"])} />}
      {children}
    </span>
  );
};

export function statusToTone(status: string): "default" | "success" | "warning" | "danger" | "info" {
  const s = status.toLowerCase();
  if (s === "paid" || s === "confirmed" || s === "partially_paid") return "success";
  if (s === "payment_required" || s === "payment_in_process") return "warning";
  if (s === "cancelled" || s === "invalid") return "danger";
  if (s === "delivered") return "info";
  if (s === "pending" || s === "ready_to_ship") return "info";
  if (s === "pending_cancel") return "warning";
  return "default";
}
