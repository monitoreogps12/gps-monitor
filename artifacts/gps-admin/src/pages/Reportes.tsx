import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, WifiOff, Clock, CheckCircle, HelpCircle,
  Download, Search, RefreshCw, Wrench, XCircle, Activity,
  Filter, FileText, ChevronDown,
} from "lucide-react";
import logoUrl from "/logo-gps.png";

// ─── Types ────────────────────────────────────────────────────────────────────

type GpsStatus = "moving" | "ack" | "engine_idle" | "disconnected_red" | "disconnected_blue";
type Category = "activo" | "leve" | "atencion" | "grave" | "critico" | "sin_datos";
type OpStatus = "servicio" | "taller" | "revision" | "baja" | "desconocido";

interface ReportDevice {
  deviceId: string;
  name: string;
  plate: string;
  imei: string;
  gpsStatus: GpsStatus;
  lastConnection: string;
  daysSinceContact: number | null;
  category: Category;
  clientName: string | null;
  clientPhone: string | null;
  lat: number | null;
  lng: number | null;
  speed: number | null;
}

interface OpEntry { status: OpStatus; notes: string; updatedAt: string; }
type OpData = Record<string, OpEntry>;

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<Category, { label: string; short: string; color: string; bg: string; ring: string; icon: React.ReactNode }> = {
  critico:  { label: "CRÍTICO",  short: ">90 días",    color: "text-red-600",    bg: "bg-red-50 border-red-200",    ring: "ring-red-500",    icon: <XCircle className="w-4 h-4" /> },
  grave:    { label: "GRAVE",    short: "31–90 días",  color: "text-orange-600", bg: "bg-orange-50 border-orange-200", ring: "ring-orange-500", icon: <AlertTriangle className="w-4 h-4" /> },
  atencion: { label: "ATENCIÓN", short: "7–30 días",   color: "text-yellow-600", bg: "bg-yellow-50 border-yellow-200", ring: "ring-yellow-500", icon: <Clock className="w-4 h-4" /> },
  leve:     { label: "LEVE",     short: "1–6 días",    color: "text-blue-600",   bg: "bg-blue-50 border-blue-200",   ring: "ring-blue-500",   icon: <WifiOff className="w-4 h-4" /> },
  activo:   { label: "ACTIVO",   short: "En línea",    color: "text-green-600",  bg: "bg-green-50 border-green-200",  ring: "ring-green-500",  icon: <CheckCircle className="w-4 h-4" /> },
  sin_datos:{ label: "SIN DATOS",short: "Sin registro",color: "text-gray-500",   bg: "bg-gray-50 border-gray-200",   ring: "ring-gray-400",   icon: <HelpCircle className="w-4 h-4" /> },
};

const OP_STATUS_META: Record<OpStatus, { label: string; color: string; bg: string }> = {
  servicio:    { label: "En Servicio",      color: "text-green-700",  bg: "bg-green-100" },
  taller:      { label: "En Taller",        color: "text-orange-700", bg: "bg-orange-100" },
  revision:    { label: "Necesita Revisión",color: "text-yellow-700", bg: "bg-yellow-100" },
  baja:        { label: "Fuera de Servicio",color: "text-red-700",    bg: "bg-red-100" },
  desconocido: { label: "Desconocido",      color: "text-gray-500",   bg: "bg-gray-100" },
};

const GPS_LABELS: Record<string, string> = {
  moving: "En Movimiento",
  ack: "Encendido",
  engine_idle: "Ralentí",
  disconnected_red: "Sin Señal",
  disconnected_blue: "Desconectado",
};

const STORAGE_KEY = "gps-op-status-v2";
const TAB_ORDER: Array<Category | "todos"> = ["todos", "critico", "grave", "atencion", "leve", "sin_datos", "activo"];

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useOpData(): [OpData, (deviceId: string, entry: Partial<OpEntry>) => void] {
  const [data, setData] = useState<OpData>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); }
    catch { return {}; }
  });

  const update = (deviceId: string, entry: Partial<OpEntry>) => {
    setData((prev) => {
      const existing = prev[deviceId];
      const merged: OpEntry = {
        status: entry.status ?? existing?.status ?? "desconocido",
        notes: entry.notes ?? existing?.notes ?? "",
        updatedAt: new Date().toISOString(),
      };
      const next = { ...prev, [deviceId]: merged };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return [data, update];
}

// ─── Animated counter ─────────────────────────────────────────────────────────

function AnimatedCount({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = Math.ceil(value / 20);
    const timer = setInterval(() => {
      start = Math.min(start + step, value);
      setDisplay(start);
      if (start >= value) clearInterval(timer);
    }, 40);
    return () => clearInterval(timer);
  }, [value]);
  return <>{display}</>;
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ category, count, active, onClick }: {
  category: Category; count: number; active: boolean; onClick: () => void;
}) {
  const m = CATEGORY_META[category];
  return (
    <button
      onClick={onClick}
      className={`
        relative overflow-hidden rounded-xl border-2 p-4 text-left w-full
        transition-all duration-200 hover:scale-105 hover:shadow-lg
        ${active ? `${m.bg} ring-2 ${m.ring} shadow-md scale-105` : "bg-white border-gray-200 hover:border-gray-300"}
      `}
    >
      <div className={`flex items-center gap-2 mb-2 ${m.color}`}>
        {m.icon}
        <span className="text-xs font-bold uppercase tracking-wider">{m.label}</span>
      </div>
      <div className={`text-3xl font-black ${m.color}`}>
        <AnimatedCount value={count} />
      </div>
      <div className="text-xs text-gray-400 mt-1">{m.short}</div>
      {active && <div className={`absolute bottom-0 left-0 right-0 h-1 ${m.color.replace("text-", "bg-")}`} />}
    </button>
  );
}

// ─── Row Status Selector ──────────────────────────────────────────────────────

function StatusSelector({ deviceId, current, notes, onUpdate }: {
  deviceId: string;
  current: OpStatus;
  notes: string;
  onUpdate: (deviceId: string, entry: Partial<OpEntry>) => void;
}) {
  const [open, setOpen] = useState(false);
  const m = OP_STATUS_META[current];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${m.bg} ${m.color} hover:opacity-80 transition-opacity`}
      >
        {m.label}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute z-50 top-7 left-0 bg-white rounded-xl shadow-xl border border-gray-200 py-1 min-w-44 animate-fade-in">
          {(Object.keys(OP_STATUS_META) as OpStatus[]).map((s) => {
            const sm = OP_STATUS_META[s];
            return (
              <button
                key={s}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${sm.color} font-medium`}
                onClick={() => { onUpdate(deviceId, { status: s }); setOpen(false); }}
              >
                {sm.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Category Badge ───────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: Category }) {
  const m = CATEGORY_META[category];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${m.bg} ${m.color}`}>
      {m.icon}{m.label}
    </span>
  );
}

// ─── Days Badge ───────────────────────────────────────────────────────────────

function DaysBadge({ days, category }: { days: number | null; category: Category }) {
  if (days === null) return <span className="text-gray-400 text-xs">—</span>;
  const m = CATEGORY_META[category];
  return (
    <span className={`font-black text-base ${m.color}`}>
      {days}
      <span className="text-xs font-normal ml-0.5">d</span>
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Reportes() {
  const [activeTab, setActiveTab] = useState<Category | "todos">("todos");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [opData, updateOp] = useOpData();
  const [editingNotes, setEditingNotes] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery<ReportDevice[]>({
    queryKey: ["reports-data"],
    queryFn: () => fetch("/api/reports/data").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const counts = useMemo(() => {
    if (!data) return {} as Record<Category | "todos", number>;
    const r = data.reduce(
      (acc, d) => { acc[d.category] = (acc[d.category] ?? 0) + 1; return acc; },
      {} as Record<string, number>
    );
    r["todos"] = data.length;
    return r as Record<Category | "todos", number>;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = activeTab === "todos" ? data : data.filter((d) => d.category === activeTab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (d) =>
          d.plate.toLowerCase().includes(q) ||
          d.name.toLowerCase().includes(q) ||
          (d.clientName ?? "").toLowerCase().includes(q) ||
          d.imei.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => (b.daysSinceContact ?? -1) - (a.daysSinceContact ?? -1));
  }, [data, activeTab, search]);

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch("/api/reports/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusData: opData }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Reporte_Fallas_GPS_${new Date().toISOString().split("T")[0]}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Error al generar el Excel. Intente de nuevo.");
    } finally {
      setExporting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <div className="w-16 h-16 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
        <p className="text-gray-500 font-medium animate-pulse">Consultando flota completa…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-red-500">
        <XCircle className="w-12 h-12" />
        <p className="font-semibold">Error al cargar los datos</p>
        <button onClick={() => refetch()} className="text-sm underline text-blue-600">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <img src={logoUrl} alt="GPS SISTEMA C.A." className="w-14 h-14 rounded-xl object-contain shadow-md border border-gray-100 bg-white p-1" />
          <div>
            <h1 className="text-2xl font-black text-gray-900 leading-tight">Reporte de Fallas</h1>
            <p className="text-sm text-gray-500 mt-0.5">GPS SISTEMA C.A. — Identificación y seguimiento de unidades</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-60"
          >
            {exporting
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />
            }
            {exporting ? "Generando…" : "Exportar Excel"}
          </button>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {(["critico", "grave", "atencion", "leve", "activo", "sin_datos"] as Category[]).map((cat) => (
          <StatCard
            key={cat}
            category={cat}
            count={counts[cat] ?? 0}
            active={activeTab === cat}
            onClick={() => setActiveTab(activeTab === cat ? "todos" : cat)}
          />
        ))}
      </div>

      {/* ── Alerts summary ── */}
      {(counts["critico"] > 0 || counts["grave"] > 0) && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700">
          <AlertTriangle className="w-5 h-5 shrink-0 animate-pulse" />
          <p className="text-sm font-semibold">
            {counts["critico"] > 0 && `${counts["critico"]} vehículo(s) CRÍTICO(S) sin conexión por más de 90 días. `}
            {counts["grave"] > 0 && `${counts["grave"]} vehículo(s) con más de 30 días sin señal.`}
            {" "}Se requiere atención inmediata.
          </p>
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400 shrink-0" />
          {TAB_ORDER.map((tab) => {
            const label = tab === "todos" ? "Todos" : CATEGORY_META[tab].label;
            const count = counts[tab] ?? 0;
            const m = tab !== "todos" ? CATEGORY_META[tab] : null;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`
                  px-3 py-1.5 rounded-full text-xs font-bold border transition-all
                  ${activeTab === tab
                    ? (m ? `${m.bg} ${m.color} border-current ring-1 ${m.ring}` : "bg-gray-900 text-white border-gray-900")
                    : "bg-gray-100 text-gray-600 border-transparent hover:bg-gray-200"
                  }
                `}
              >
                {label}
                <span className="ml-1.5 opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por placa, vehículo, cliente o IMEI…"
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-semibold text-gray-700">
              {filtered.length} unidad(es) mostrada(s)
            </span>
          </div>
          {isFetching && (
            <span className="text-xs text-blue-500 flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin" /> Actualizando…
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-8">#</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Placa</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Vehículo</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Cliente</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Último Contacto</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Días</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Categoría</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Estado GPS</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Estado Operacional</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Observaciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    No hay vehículos en esta categoría
                  </td>
                </tr>
              ) : (
                filtered.map((device, idx) => {
                  const op = opData[device.deviceId];
                  const opStatus: OpStatus = op?.status ?? "desconocido";
                  const catMeta = CATEGORY_META[device.category];
                  const isEditing = editingNotes === device.deviceId;

                  return (
                    <tr
                      key={device.deviceId}
                      className={`hover:bg-gray-50 transition-colors ${device.category === "critico" ? "bg-red-50/30" : device.category === "grave" ? "bg-orange-50/20" : ""}`}
                    >
                      <td className="px-4 py-2.5 text-gray-400 text-xs font-mono">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-bold text-gray-900 font-mono text-sm">{device.plate || "—"}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-800 text-xs leading-tight max-w-[180px] truncate" title={device.name}>{device.name}</p>
                        {device.imei && <p className="text-gray-400 text-[10px] font-mono">{device.imei}</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        {device.clientName
                          ? <div>
                              <p className="text-xs font-semibold text-gray-700">{device.clientName}</p>
                              {device.clientPhone && <p className="text-[10px] text-gray-400">{device.clientPhone}</p>}
                            </div>
                          : <span className="text-[10px] text-gray-300 italic">Sin asignar</span>
                        }
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[150px]">
                        <span className="block truncate" title={device.lastConnection}>{device.lastConnection || "—"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <DaysBadge days={device.daysSinceContact} category={device.category} />
                      </td>
                      <td className="px-4 py-2.5">
                        <CategoryBadge category={device.category} />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-medium ${catMeta.color}`}>
                          {GPS_LABELS[device.gpsStatus] ?? device.gpsStatus}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusSelector
                          deviceId={device.deviceId}
                          current={opStatus}
                          notes={op?.notes ?? ""}
                          onUpdate={updateOp}
                        />
                      </td>
                      <td className="px-4 py-2.5 min-w-[140px]">
                        {isEditing ? (
                          <input
                            autoFocus
                            defaultValue={op?.notes ?? ""}
                            onBlur={(e) => {
                              updateOp(device.deviceId, { notes: e.target.value });
                              setEditingNotes(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") setEditingNotes(null);
                            }}
                            className="w-full text-xs border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="Agregar nota…"
                          />
                        ) : (
                          <button
                            onClick={() => setEditingNotes(device.deviceId)}
                            className="text-xs text-gray-400 hover:text-blue-600 hover:underline text-left w-full truncate block max-w-[130px]"
                            title={op?.notes || "Clic para agregar nota"}
                          >
                            {op?.notes || <span className="italic text-gray-300">+ agregar nota</span>}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-xs text-gray-400">
          <span>GPS SISTEMA C.A. — Sistema de Monitoreo</span>
          <span>Actualización automática cada 60s</span>
        </div>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {(Object.keys(OP_STATUS_META) as OpStatus[]).map((s) => {
          const m = OP_STATUS_META[s];
          return (
            <div key={s} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${m.bg} border border-gray-100`}>
              {s === "servicio" && <CheckCircle className={`w-4 h-4 ${m.color}`} />}
              {s === "taller" && <Wrench className={`w-4 h-4 ${m.color}`} />}
              {s === "revision" && <AlertTriangle className={`w-4 h-4 ${m.color}`} />}
              {s === "baja" && <XCircle className={`w-4 h-4 ${m.color}`} />}
              {s === "desconocido" && <HelpCircle className={`w-4 h-4 ${m.color}`} />}
              <span className={`text-xs font-semibold ${m.color}`}>{m.label}</span>
            </div>
          );
        })}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
          <Activity className="w-4 h-4 text-gray-400" />
          <span className="text-xs text-gray-500">Estado guardado localmente</span>
        </div>
      </div>
    </div>
  );
}
