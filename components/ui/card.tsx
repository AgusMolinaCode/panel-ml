import * as React from "react";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Use the elevated surface (slightly lighter) — for nested or hover states. */
  elevated?: boolean;
  /** Add a subtle gradient accent line at the top (indigo glow). */
  glow?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className, elevated = false, glow = false, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative rounded-xl border border-border text-card-foreground shadow-sm transition-colors",
        elevated ? "bg-card-elevated" : "bg-card",
        "hover:border-border/80",
        glow && "overflow-hidden",
        className
      )}
      {...rest}
    >
      {glow && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
        />
      )}
      {children}
    </div>
  )
);
Card.displayName = "Card";

export const CardHeader: React.FC<{
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}> = ({ title, description, action, icon }) => (
  <div className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-4">
    <div className="flex items-start gap-3 min-w-0">
      {icon && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <h3 className="text-sm font-semibold leading-none tracking-tight truncate">
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

export const CardBody: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => <div className={cn("px-6 py-4", className)}>{children}</div>;
