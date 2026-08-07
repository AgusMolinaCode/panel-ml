import * as React from "react";
import { cn } from "@/lib/utils";

export const Table: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div className="overflow-x-auto">
    <table className={cn("w-full caption-bottom text-sm", className)}>{children}</table>
  </div>
);

export const THead: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
    {children}
  </thead>
);

export const TBody: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <tbody className="[&_tr:last-child]:border-0">{children}</tbody>
);

export const TR: React.FC<{ children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties; className?: string }> = ({
  children,
  onClick,
  style,
  className,
}) => (
  <tr
    className={cn(
      "border-b border-border/60 transition-colors",
      "hover:bg-muted/30",
      onClick && "cursor-pointer",
      className
    )}
    onClick={onClick}
    style={style}
  >
    {children}
  </tr>
);

export const TH: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <th className={cn("h-10 px-4 text-left align-middle font-medium", className)}>
    {children}
  </th>
);

export const TD: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>;

export const EmptyRow: React.FC<{ colSpan: number; message: string }> = ({
  colSpan,
  message,
}) => (
  <tr>
    <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-muted-foreground">
      {message}
    </td>
  </tr>
);