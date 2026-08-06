"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccordionProps {
  children: React.ReactNode;
  className?: string;
}

interface AccordionItemProps {
  children: React.ReactNode;
  className?: string;
  value: string;
}

interface AccordionContextValue {
  openValue: string | null;
  setOpenValue: (value: string | null) => void;
}

const AccordionContext = React.createContext<AccordionContextValue | null>(null);

function useAccordion() {
  const ctx = React.useContext(AccordionContext);
  if (!ctx) throw new Error("Accordion components must be used inside <Accordion>");
  return ctx;
}

export function Accordion({ children, className }: AccordionProps) {
  const [openValue, setOpenValue] = React.useState<string | null>(null);
  return (
    <AccordionContext.Provider value={{ openValue, setOpenValue }}>
      <div className={cn("space-y-2", className)}>{children}</div>
    </AccordionContext.Provider>
  );
}

export function AccordionItem({ children, className, value }: AccordionItemProps) {
  return (
    <div className={cn("border rounded-lg overflow-hidden", className)} data-value={value}>
      {children}
    </div>
  );
}

interface AccordionTriggerProps {
  children: React.ReactNode;
  className?: string;
  value: string;
}

export function AccordionTrigger({ children, className, value }: AccordionTriggerProps) {
  const { openValue, setOpenValue } = useAccordion();
  const isOpen = openValue === value;

  return (
    <button
      type="button"
      onClick={() => setOpenValue(isOpen ? null : value)}
      className={cn(
        "flex w-full items-center justify-between px-4 py-3 text-sm font-medium transition-all hover:bg-muted/50",
        className
      )}
    >
      {children}
      <ChevronDown
        className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")}
      />
    </button>
  );
}

interface AccordionContentProps {
  children: React.ReactNode;
  className?: string;
  value: string;
}

export function AccordionContent({ children, className, value }: AccordionContentProps) {
  const { openValue } = useAccordion();
  const isOpen = openValue === value;

  return (
    <div
      className={cn(
        "overflow-hidden transition-all duration-200",
        isOpen ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
      )}
    >
      <div className={cn("px-4 pb-4 pt-1", className)}>{children}</div>
    </div>
  );
}
