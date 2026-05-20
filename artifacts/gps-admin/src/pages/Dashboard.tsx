import {
  useGetFleetStats,
  getGetFleetStatsQueryKey,
  useGetRecentEvents,
  getGetRecentEventsQueryKey,
  type RecentEvent,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Car, WifiOff, AlertCircle, Clock, Bell, MapPin, ExternalLink } from "lucide-react";
import { getStatusColor } from "@/lib/status-colors";

// ── Color por tipo de evento ────────────────────────────────────────────────
function eventColor(message: string): { bg: string; text: string; dot: string } {
  const m = message.toLowerCase();
  if (m.includes("encendido")) return { bg: "#052b1a", text: "#22c55e", dot: "#22c55e" };
  if (m.includes("apagado")) return { bg: "#1a0505", text: "#ef4444", dot: "#ef4444" };
  if (m.includes("entrar") || m.includes("entrada"))
    return { bg: "#05112b", text: "#60a5fa", dot: "#3b82f6" };
  if (m.includes("salir") || m.includes("salida") || m.includes("zona"))
    return { bg: "#1a0a00", text: "#fb923c", dot: "#f97316" };
  if (m.includes("velocidad") || m.includes("speed"))
    return { bg: "#1a1000", text: "#facc15", dot: "#eab308" };
  return { bg: "#0a1020", text: "#94a3b8", dot: "#64748b" };
}

function EventIcon({ message }: { message: string }) {
  const m = message.toLowerCase();
  if (m.includes("encendido")) return <span className="text-base">🟢</span>;
  if (m.includes("apagado")) return <span className="text-base">🔴</span>;
  if (m.includes("entrar") || m.includes("entrada")) return <span className="text-base">📥</span>;
  if (m.includes("salir") || m.includes("salida") || m.includes("zona")) return <span className="text-base">📤</span>;
  if (m.includes("velocidad")) return <span className="text-base">⚡</span>;
  return <span className="text-base">📡</span>;
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  return `hace ${h}h`;
}

// ── Event Row ──────────────────────────────────────────────────────────────
function EventRow({ event }: { event: RecentEvent }) {
  const c = eventColor(event.message);
  const hasLocation = event.lat && event.lng;
  const mapsUrl = hasLocation
    ? `https://www.google.com/maps?q=${event.lat},${event.lng}`
    : null;

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors hover:brightness-110"
      style={{ background: c.bg + "cc", borderColor: c.dot + "33" }}
    >
      {/* Dot */}
      <div
        className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
        style={{ background: c.dot, boxShadow: `0 0 6px ${c.dot}99` }}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <EventIcon message={event.message} />
          <span className="font-bold text-sm text-foreground">
            {event.plate || event.deviceName || `Dispositivo ${event.deviceId}`}
          </span>
          {event.deviceName && event.plate && event.deviceName !== event.plate && (
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              {event.deviceName}
            </span>
          )}
        </div>

        <div className="text-xs mt-0.5 font-medium" style={{ color: c.text }}>
          {event.message}
        </div>

        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground">{event.time}</span>

          {event.clientNames.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-400 bg-sky-950/60 border border-sky-800/40 rounded-full px-2 py-0.5">
              <Bell className="w-2.5 h-2.5" />
              {event.dispatched ? "Enviado" : "Sin Telegram"} · {event.clientNames.join(", ")}
            </span>
          )}

          {hasLocation && (
            <a
              href={mapsUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              <MapPin className="w-2.5 h-2.5" />
              Ver ubicación
              <ExternalLink className="w-2 h-2" />
            </a>
          )}
        </div>
      </div>

      {/* Time ago */}
      <div className="text-[10px] text-muted-foreground flex-shrink-0 mt-1 tabular-nums">
        {timeAgo(event.seenAt)}
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────
export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetFleetStats({
    query: { refetchInterval: 15000, queryKey: getGetFleetStatsQueryKey() },
  });

  const { data: events = [], isLoading: eventsLoading } = useGetRecentEvents(
    { limit: 50 },
    { query: { refetchInterval: 5000, queryKey: getGetRecentEventsQueryKey() } }
  );

  const dispatchedCount = events.filter((e) => e.dispatched).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Estado de la flota y eventos de rastreoplus247.com en tiempo real.
        </p>
      </div>

      {/* ── Stats cards ── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Vehículos</CardTitle>
            <Car className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statsLoading ? "–" : stats?.total ?? 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-green-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-500">En Movimiento</CardTitle>
            <Activity className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{statsLoading ? "–" : stats?.moving ?? 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-blue-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-blue-500">Desconectados</CardTitle>
            <WifiOff className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">{statsLoading ? "–" : stats?.disconnected ?? 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-yellow-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-yellow-500">ACK</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-500">{statsLoading ? "–" : stats?.ack ?? 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-orange-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-orange-500">Ralentí</CardTitle>
            <Clock className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{statsLoading ? "–" : stats?.engineIdle ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* ── Events feed ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              Eventos en Tiempo Real
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Eventos recibidos de rastreoplus247.com · actualización cada 5s
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dispatchedCount > 0 && (
              <span className="text-xs text-sky-400 font-semibold bg-sky-950/60 border border-sky-800/40 rounded-full px-2.5 py-1">
                🔔 {dispatchedCount} enviado{dispatchedCount !== 1 ? "s" : ""} a clientes
              </span>
            )}
            <span className="text-xs text-muted-foreground bg-muted/40 rounded-full px-2.5 py-1 font-mono tabular-nums">
              {events.length} eventos
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {eventsLoading ? (
            <div className="text-sm text-muted-foreground py-10 text-center">
              Cargando eventos…
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <Bell className="w-8 h-8 opacity-20" />
              <p className="text-sm">Esperando eventos de la plataforma…</p>
              <p className="text-xs opacity-60">Los eventos aparecerán aquí en cuanto lleguen</p>
            </div>
          ) : (
            <div className="space-y-1.5 px-4 pb-4 pt-1 max-h-[520px] overflow-y-auto">
              {events.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
