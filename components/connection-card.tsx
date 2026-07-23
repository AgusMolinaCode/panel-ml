"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, Unplug, ExternalLink, Power, PowerOff } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { cn } from "@/lib/utils";

interface AuthStatus {
  connected: boolean;
  user_id?: number;
  nickname?: string | null;
  email?: string | null;
  expires_at?: number;
  expires_in_minutes?: number;
  is_expired?: boolean;
  expires_soon?: boolean;
  scope?: string | null;
}

interface Props {
  initialStatus: AuthStatus;
}

export function ConnectionCard({ initialStatus }: Props) {
  const [status, setStatus] = useState<AuthStatus>(initialStatus);
  const [open, setOpen] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/auth/status");
      const data = (await res.json()) as AuthStatus;
      setStatus(data);
    } catch (err) {
      console.error("Failed to refresh status:", err);
    }
  }, []);

  // Light polling every 30s to keep "expires in X min" fresh on the badge
  useEffect(() => {
    const t = setInterval(() => {
      void refreshStatus();
    }, 30_000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  // Auto-refresh: when the status reports the token is expired or about to
  // expire, fire a refresh without waiting for the user to click anything.
  // We debounce so a flurry of status changes (or a temporary network blip
  // that marks the token expired) doesn't spam the refresh endpoint.
  const autoRefreshInFlight = React.useRef(false);
  useEffect(() => {
    if (!status.connected) return;
    if (!status.is_expired && !status.expires_soon) return;
    if (autoRefreshInFlight.current) return;

    autoRefreshInFlight.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST" });
        if (res.ok) {
          await refreshStatus();
        }
      } catch (err) {
        console.error("Auto-refresh failed:", err);
      } finally {
        // Small cooldown so we don't hammer the endpoint if something's wrong
        setTimeout(() => {
          autoRefreshInFlight.current = false;
        }, 5_000);
      }
    })();
  }, [status.connected, status.is_expired, status.expires_soon, refreshStatus]);

  async function handleStartAuth(): Promise<void> {
    setError(null);
    try {
      const res = await fetch("/api/auth/login", { method: "POST" });
      const data = (await res.json()) as { authorization_url?: string; error?: string };
      if (data.authorization_url) {
        window.open(data.authorization_url, "_blank", "noopener,noreferrer");
        setAuthUrl(data.authorization_url);
      } else {
        setError(data.error ?? "No se pudo generar la URL de autorización");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }

  async function handleSubmitCode(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!code.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/manual-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        user_id?: number;
        expires_in?: number;
      };
      if (!res.ok || !data.success) {
        setError(data.error ?? `Error ${res.status}`);
        return;
      }
      await refreshStatus();
      setCode("");
      setAuthUrl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    setError(null);
    try {
      const res = await fetch("/api/auth/refresh", { method: "POST" });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) setError(data.error ?? "Error al refrescar");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }

  async function handleDisconnect(): Promise<void> {
    if (!confirm("¿Desconectar tu cuenta de MercadoLibre?")) return;
    setError(null);
    try {
      await fetch("/api/auth/disconnect", { method: "POST" });
      await refreshStatus();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }

  // ---------- Compact indicator (always visible) ----------
  const isConnected = status.connected;
  const isExpired = !!status.is_expired;
  const isWarning = !!status.expires_soon;

  const dotTone = isConnected ? (isExpired ? "danger" : isWarning ? "warning" : "success") : "danger";
  const label = isConnected
    ? isExpired
      ? "Token expirado"
      : isWarning
      ? "Conectado · por vencer"
      : "Conectado"
    : "Desconectado";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex items-center gap-2.5 rounded-full border bg-card backdrop-blur px-3.5 py-1.5 text-sm font-medium",
            "shadow-sm transition-all hover:bg-card hover:shadow-md",
            dotTone === "success" && "border-success/30 hover:border-success/50",
            dotTone === "warning" && "border-warning/30 hover:border-warning/50",
            dotTone === "danger" && "border-destructive/30 hover:border-destructive/50"
          )}
          aria-label={label}
        >
          <PulseDot tone={dotTone} />
          <span className="text-foreground">{label}</span>
          {isConnected && status.nickname && (
            <>
              <span className="hidden text-muted-foreground/60 sm:inline">·</span>
              <span className="hidden text-muted-foreground sm:inline">{status.nickname}</span>
            </>
          )}
        </button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Power className="h-5 w-5" /> Conexión con MercadoLibre
          </DialogTitle>
          <DialogDescription>
            {isConnected
              ? "Detalles de la autenticación OAuth y acciones."
              : "Conectá tu cuenta para empezar a sincronizar ventas."}
          </DialogDescription>
        </DialogHeader>

        {isConnected ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Usuario" value={status.nickname ?? `#${status.user_id}`} />
              <Field label="User ID" value={String(status.user_id ?? "—")} mono />
              <Field label="Email" value={status.email ?? "—"} />
              <Field
                label="Token expira"
                value={
                  status.expires_in_minutes !== undefined
                    ? status.expires_in_minutes > 0
                      ? `en ${status.expires_in_minutes} min`
                      : "expirado"
                    : "—"
                }
                mono
              />
              <Field
                label="Estado"
                value={
                  isExpired ? "Expirado" : isWarning ? "Por vencer" : "OK"
                }
              />
              <Field label="Scope" value={status.scope ?? "—"} mono />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={handleRefresh} size="sm" variant="secondary">
                <RefreshCw className="h-4 w-4" /> Refrescar token
              </Button>
              <Button onClick={handleDisconnect} size="sm" variant="ghost">
                <Unplug className="h-4 w-4" /> Desconectar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {!authUrl ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Hacé click en "Conectar". Se abre MercadoLibre en una pestaña nueva.
                  Después de autorizar, ML te redirige a tu dominio configurado y te
                  devuelve un código. Pegalo abajo.
                </p>
                <Button onClick={handleStartAuth}>
                  <ExternalLink className="h-4 w-4" /> Conectar con MercadoLibre
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmitCode} className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Autorizá la app en MercadoLibre. Cuando termines, copiá la URL
                  completa o solo el code:
                </p>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="https://www.am-motos-repuestos.com.ar/?code=TG-...   o   TG-..."
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={submitting}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" loading={submitting} disabled={!code.trim()}>
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Vincular código
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAuthUrl(null);
                      setCode("");
                      setError(null);
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            )}

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PulseDot({ tone }: { tone: "success" | "warning" | "danger" }) {
  const ring =
    tone === "success"
      ? "bg-success/40"
      : tone === "warning"
      ? "bg-warning/40"
      : "bg-destructive/40";
  const core =
    tone === "success"
      ? "bg-success shadow-[0_0_8px_var(--success)]"
      : tone === "warning"
      ? "bg-warning shadow-[0_0_8px_var(--warning)]"
      : "bg-destructive shadow-[0_0_8px_var(--destructive)]";
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      <span
        className={cn(
          "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
          ring
        )}
      />
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", core)} />
    </span>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm ${mono ? "font-mono" : ""} break-all`}>{value}</div>
    </div>
  );
}