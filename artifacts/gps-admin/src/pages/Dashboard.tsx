import {
  useGetFleetStats,
  getGetFleetStatsQueryKey,
  useGetRecentEvents,
  getGetRecentEventsQueryKey,
  type RecentEvent,
} from "@workspace/api-client-react";
import { Activity, Car, WifiOff, AlertCircle, Clock, Bell, MapPin, ExternalLink, TrendingUp } from "lucide-react";

// ── helpers ────────────────────────────────────────────────────────────────
function eventColor(message: string): { bg: string; border: string; text: string; dot: string } {
  const m = message.toLowerCase();
  if (m.includes("encendido")) return { bg: "rgba(5,43,26,0.9)", border: "#16a34a33", text: "#22c55e", dot: "#22c55e" };
  if (m.includes("apagado"))   return { bg: "rgba(26,5,5,0.9)",  border: "#dc262633", text: "#ef4444", dot: "#ef4444" };
  if (m.includes("entrar") || m.includes("entrada"))
    return { bg: "rgba(5,17,43,0.9)", border: "#3b82f633", text: "#60a5fa", dot: "#3b82f6" };
  if (m.includes("salir") || m.includes("salida") || m.includes("zona"))
    return { bg: "rgba(26,10,0,0.9)", border: "#f9731633", text: "#fb923c", dot: "#f97316" };
  if (m.includes("velocidad") || m.includes("speed"))
    return { bg: "rgba(26,16,0,0.9)", border: "#eab30833", text: "#facc15", dot: "#eab308" };
  return { bg: "rgba(10,16,32,0.85)", border: "#64748b22", text: "#94a3b8", dot: "#64748b" };
}

function EventIcon({ message }: { message: string }) {
  const m = message.toLowerCase();
  if (m.includes("encendido")) return <span className="text-sm">🟢</span>;
  if (m.includes("apagado"))   return <span className="text-sm">🔴</span>;
  if (m.includes("entrar") || m.includes("entrada")) return <span className="text-sm">📥</span>;
  if (m.includes("salir") || m.includes("salida") || m.includes("zona")) return <span className="text-sm">📤</span>;
  if (m.includes("velocidad")) return <span className="text-sm">⚡</span>;
  return <span className="text-sm">📡</span>;
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  return `hace ${Math.floor(m / 60)}h`;
}

// ── Stat Card ──────────────────────────────────────────────────────────────
function StatCard({
  label, value, icon: Icon, color, glow, bg, loading,
}: {
  label: string;
  value: number | undefined;
  icon: React.ElementType;
  color: string;
  glow: string;
  bg: string;
  loading: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-3 relative overflow-hidden transition-transform hover:-translate-y-0.5 cursor-default"
      style={{
        background: bg,
        border: `1px solid ${color}22`,
        boxShadow: `0 4px 24px ${glow}`,
      }}
    >
      <div
        className="absolute -top-6 -right-6 w-24 h-24 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${color}30 0%, transparent 70%)` }}
      />
      <div className="flex items-center justify-between relative z-10">
        <span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: `${color}99` }}>
          {label}
        </span>
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `${color}18`, border: `1px solid ${color}30` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <div className="relative z-10">
        <span
          className="text-4xl font-black tabular-nums"
          style={{ color, textShadow: `0 0 24px ${color}55` }}
        >
          {loading ? "–" : (value ?? 0)}
        </span>
      </div>
    </div>
  );
}

// ── Event Row ──────────────────────────────────────────────────────────────
function EventRow({ event }: { event: RecentEvent }) {
  const c = eventColor(event.message);
  const hasLocation = event.lat && event.lng;
  const mapsUrl = hasLocation ? `https://www.google.com/maps?q=${event.lat},${event.lng}` : null;

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-xl border transition-all hover:brightness-110"
      style={{ background: c.bg, borderColor: c.border }}
    >
      <div
        className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
        style={{ background: c.dot, boxShadow: `0 0 6px ${c.dot}99` }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <EventIcon message={event.message} />
          <span className="font-bold text-sm text-white">
            {event.plate || event.deviceName || `Dispositivo ${event.deviceId}`}
          </span>
          {event.deviceName && event.plate && event.deviceName !== event.plate && (
            <span className="text-xs text-white/40 truncate hidden sm:inline">{event.deviceName}</span>
          )}
        </div>
        <div className="text-xs mt-0.5 font-semibold" style={{ color: c.text }}>{event.message}</div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="text-[10px] text-white/35">{event.time}</span>
          {event.clientNames.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-300 bg-sky-950/60 border border-sky-700/30 rounded-full px-2 py-0.5">
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
      <div className="text-[10px] text-white/30 flex-shrink-0 mt-1 tabular-nums">{timeAgo(event.seenAt)}</div>
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
    <div className="space-y-5">

      {/* ── Brand Banner ── */}
      <div
        className="rounded-2xl px-6 py-5 flex items-center justify-between relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #0A1A3E 0%, #0D2255 55%, #0A1A3E 100%)",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 8px 40px rgba(10,26,62,0.45)",
        }}
      >
        <div className="absolute top-0 right-0 w-56 h-56 rounded-full pointer-events-none opacity-20"
          style={{ background: "radial-gradient(circle, #1E6FBF 0%, transparent 70%)", transform: "translate(35%,-35%)" }} />
        <div className="absolute bottom-0 left-1/3 w-40 h-40 rounded-full pointer-events-none opacity-10"
          style={{ background: "radial-gradient(circle, #E8720C 0%, transparent 70%)", transform: "translateY(40%)" }} />

        <div className="relative z-10 flex items-center gap-4">
          <img src="/logo-gps.png" alt="GPS SISTEMA C.A." className="w-14 h-14 object-contain drop-shadow-lg" />
          <div>
            <h1 className="text-lg font-black text-white tracking-tight">GPS SISTEMA C.A.</h1>
            <p className="text-xs text-white/45 mt-0.5">rastreoplus247.com · Monitoreo en tiempo real</p>
            <div className="mt-2.5 h-0.5 w-28 brand-gradient rounded-full opacity-80" />
          </div>
        </div>

        <div className="relative z-10 hidden md:flex items-center gap-8">
          {[
            { val: stats?.total,      label: "Vehículos",     color: "#60a5fa" },
            { val: stats?.moving,     label: "En Movimiento", color: "#22c55e" },
            { val: dispatchedCount,   label: "Alertas Hoy",   color: "#f97316" },
          ].map((item, i) => (
            <div key={i} className="text-center">
              <div className="text-3xl font-black tabular-nums" style={{ color: item.color, textShadow: `0 0 20px ${item.color}44` }}>
                {statsLoading ? "–" : item.val ?? 0}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/35 mt-0.5">{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Stats Grid ── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total Flota"     value={stats?.total}        icon={Car}         color="#60a5fa" glow="rgba(96,165,250,0.15)"  bg="linear-gradient(145deg,#0c1c3a,#0e2148)" loading={statsLoading} />
        <StatCard label="En Movimiento"   value={stats?.moving}       icon={Activity}    color="#22c55e" glow="rgba(34,197,94,0.15)"   bg="linear-gradient(145deg,#061a0f,#072415)" loading={statsLoading} />
        <StatCard label="Desconectados"   value={stats?.disconnected} icon={WifiOff}     color="#3b82f6" glow="rgba(59,130,246,0.12)"  bg="linear-gradient(145deg,#060f24,#081530)" loading={statsLoading} />
        <StatCard label="ACK"             value={stats?.ack}          icon={AlertCircle} color="#eab308" glow="rgba(234,179,8,0.12)"   bg="linear-gradient(145deg,#1a1400,#221b00)" loading={statsLoading} />
        <StatCard label="Ralentí"         value={stats?.engineIdle}   icon={Clock}       color="#f97316" glow="rgba(249,115,22,0.15)"  bg="linear-gradient(145deg,#1a0800,#221000)" loading={statsLoading} />
      </div>

      {/* ── Events Feed ── */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #0A1A3E 0%, #060E22 100%)",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 8px 40px rgba(5,10,25,0.35)",
        }}
      >
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(232,114,12,0.15)", border: "1px solid rgba(232,114,12,0.3)" }}>
              <Bell className="w-4 h-4" style={{ color: "#E8720C" }} />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">Eventos en Tiempo Real</h3>
              <p className="text-[10px] text-white/35">rastreoplus247.com · actualización cada 5s</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dispatchedCount > 0 && (
              <span className="text-xs font-bold text-sky-300 bg-sky-950/70 border border-sky-700/30 rounded-full px-3 py-1">
                🔔 {dispatchedCount} enviado{dispatchedCount !== 1 ? "s" : ""}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-xs font-bold text-white/30 bg-white/5 border border-white/10 rounded-full px-3 py-1">
              <TrendingUp className="w-3 h-3" />
              {events.length} eventos
            </span>
          </div>
        </div>

        <div className="p-4">
          {eventsLoading ? (
            <div className="text-sm text-white/30 py-10 text-center">Cargando eventos…</div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-white/25">
              <Bell className="w-8 h-8 opacity-20" />
              <p className="text-sm">Esperando eventos de la plataforma…</p>
              <p className="text-xs opacity-60">Los eventos aparecerán aquí en cuanto lleguen</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
              {events.map((e) => <EventRow key={e.id} event={e} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
