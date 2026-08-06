import { Suspense } from "react";
import { getCredentials } from "@/lib/db";
import { startOfMonth, endOfDay } from "date-fns";
import { getOrderStats, getShipmentsToDispatch } from "@/lib/db/queries";
import { ConnectionCard } from "@/components/connection-card";
import { OrdersStats } from "@/components/orders-stats";
import { OrdersTable } from "@/components/orders-table";
import { DashboardClient } from "@/components/dashboard-client";
import { MonthlyGainsGrid } from "@/components/monthly-gains-grid";
import { MonthlyIvaSummary } from "@/components/monthly-iva-summary";
import { MonthlyExpenses } from "@/components/monthly-expenses";
import { PriceCalculator } from "@/components/price-calculator";
import { BarChart3, ShoppingCart, Wallet, LogOut } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage(): Promise<React.ReactElement> {
  const creds = await getCredentials();

  const now = new Date();
  const fromMs = startOfMonth(now).getTime();
  const toMs = endOfDay(now).getTime();

  const status = creds
    ? {
        connected: true as const,
        user_id: creds.user_id,
        nickname: creds.nickname,
        email: creds.email,
        expires_at: creds.expires_at,
        expires_in_minutes: Math.max(0, Math.floor((creds.expires_at - Date.now()) / 60000)),
        is_expired: creds.expires_at <= Date.now(),
        expires_soon: creds.expires_at - Date.now() < 15 * 60 * 1000,
        scope: creds.scope,
      }
    : { connected: false as const };

  const initialStats = await getOrderStats({ fromMs, toMs });
  const initialShipments = await getShipmentsToDispatch();

  return (
    <main className="mx-auto max-w-[110rem] px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-sm shadow-primary/30">
              <BarChart3 className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">AM Motos</h1>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
              Panel
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Sincronización automática de ventas · datos locales
          </p>
        </div>
        <ConnectionCard initialStatus={status} />
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Salir
          </button>
        </form>
      </header>

      {/* Date range + KPIs + Próximos a Enviar */}
      <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-muted" />}>
        <DashboardClient
          initialFromMs={fromMs}
          initialToMs={toMs}
          initialStats={initialStats}
          initialShipments={initialShipments}
        />
      </Suspense>

      {/* Orders table */}
      <div className="mt-6 animate-fade-in-up">
        <SectionHeader
          icon={<ShoppingCart className="h-4 w-4" />}
          title="Detalle"
          description="Órdenes sincronizadas con sus filtros y paginación"
        />
        <div className="mt-4">
          <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" />}>
            <OrdersTable fromMs={fromMs} toMs={toMs} />
          </Suspense>
        </div>
      </div>

      {/* Monthly IVA Summary */}
      {/* <div className="mt-6 animate-fade-in-up">
        <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
          <MonthlyIvaSummary />
        </Suspense>
      </div> */}

      {/* Monthly Gains Grid */}
      <div className="mt-6 animate-fade-in-up">
        <SectionHeader
          icon={<Wallet className="h-4 w-4" />}
          title="Ganancias por mes"
          description="Ganancia neta mensual según cálculo de cada orden"
        />
        <div className="mt-4">
          <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
            <MonthlyGainsGrid />
          </Suspense>
        </div>
      </div>

      {/* Monthly Expenses */}
      <div className="mt-6 animate-fade-in-up max-w-xl">
        <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
          <MonthlyExpenses />
        </Suspense>
      </div>

      {/* Price Calculator */}
      <div className="mt-6 animate-fade-in-up max-w-3xl">
        <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
          <PriceCalculator />
        </Suspense>
      </div>

      {/* Visualizaciones */}
      {/* <div className="mt-6 animate-fade-in-up">
        <SectionHeader
          icon={<BarChart3 className="h-4 w-4" />}
          title="Visualizaciones"
          description="Distribución y evolución de las ventas del período"
        />
        <div className="mt-4">
          <OrdersCharts stats={initialStats} />
        </div>
      </div> */}

      {/* Tráfico */}
      {/* <div className="mt-6 animate-fade-in-up">
        <SectionHeader
          icon={<Eye className="h-4 w-4" />}
          title="Tráfico"
          description="Visitas a tus publicaciones"
        />
        <div className="mt-4">
          <VisitsWidget initialSummary={initialVisitSummary} />
        </div>
      </div> */}

      {/* Worker activity */}
      {/* <div className="mt-12 animate-fade-in-up">
        <Card glow>
          <CardHeader
            title="Actividad del worker"
            description="Últimos jobs ejecutados en background"
            icon={<Server className="h-4 w-4" />}
          />
          <CardBody>
            <Table>
              <THead>
                <TR>
                  <TH>Job</TH>
                  <TH>Inicio</TH>
                  <TH>Duración</TH>
                  <TH>Registros</TH>
                  <TH>Estado</TH>
                </TR>
              </THead>
              <TBody>
                {syncLogs.length === 0 ? (
                  <EmptyRow
                    colSpan={5}
                    message="Sin actividad todavía. Iniciá el worker con `npm run worker` en otra terminal."
                  />
                ) : (
                  syncLogs.map((log) => (
                    <TR key={log.id}>
                      <TD className="font-mono text-xs">{log.job_name}</TD>
                      <TD className="text-muted-foreground whitespace-nowrap font-mono">
                        {log.started_at_formatted}
                      </TD>
                      <TD className="text-muted-foreground tabular-nums">
                        {log.duration_ms != null ? `${log.duration_ms}ms` : "—"}
                      </TD>
                      <TD className="tabular-nums">{log.records_processed}</TD>
                      <TD>
                        <Badge tone={statusToTone(log.status)} dot>
                          {translateStatus(log.status)}
                        </Badge>
                        {log.error_message && (
                          <div className="mt-1 text-xs text-destructive">
                            {log.error_message}
                          </div>
                        )}
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      </div> */}

      <footer className="mt-12 border-t border-border pt-6 pb-2 text-center text-xs text-muted-foreground">
        <p>
          Panel local · datos en <span className="font-mono text-foreground/80">data/ml.db</span>
        </p>
        <p className="mt-1">© {new Date().getFullYear()} AM Motos Repuestos</p>
      </footer>
    </main>
  );
}

function SectionHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-end gap-3 border-b border-border/60 pb-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}