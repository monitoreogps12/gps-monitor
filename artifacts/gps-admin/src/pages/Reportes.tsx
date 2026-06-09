import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, WifiOff, Clock, CheckCircle, HelpCircle,
  Download, Search, RefreshCw, Wrench, XCircle, Activity,
  ChevronDown, Filter, FileSpreadsheet,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = "activo" | "leve" | "atencion" | "grave" | "critico" | "sin_datos";
type OpStatus  = "servicio" | "taller" | "revision" | "baja" | "desconocido";

interface ReportDevice {
  deviceId: string;
  name: string;
  plate: string;
  imei: string;
  gpsStatus: string;
  lastConnection: string;
  daysSinceContact: number | null;
  category: Category;
  clientName: string | null;
  clientPhone: string | null;
  lat: number | null;
  lng: number | null;
}

interface OpEntry { status: OpStatus; notes: string; updatedAt: string; }
type OpData = Record<string, OpEntry>;

// ─── Constants ────────────────────────────────────────────────────────────────

const CAT: Record<Category, {
  label: string; short: string; tw: string; bg: string; ring: string; icon: React.ReactNode;
}> = {
  critico:   { label: "CRÍTICO",   short: ">90 días",     tw: "text-red-600",    bg: "bg-red-50 border-red-200",      ring: "ring-red-500",    icon: <XCircle className="w-4 h-4" /> },
  grave:     { label: "GRAVE",     short: "31–90 días",   tw: "text-orange-600", bg: "bg-orange-50 border-orange-200",ring: "ring-orange-500", icon: <AlertTriangle className="w-4 h-4" /> },
  atencion:  { label: "ATENCIÓN",  short: "7–30 días",    tw: "text-yellow-600", bg: "bg-yellow-50 border-yellow-200",ring: "ring-yellow-500", icon: <Clock className="w-4 h-4" /> },
  leve:      { label: "LEVE",      short: "1–6 días",     tw: "text-blue-600",   bg: "bg-blue-50 border-blue-200",    ring: "ring-blue-500",   icon: <WifiOff className="w-4 h-4" /> },
  activo:    { label: "ACTIVO",    short: "En línea",     tw: "text-green-600",  bg: "bg-green-50 border-green-200",  ring: "ring-green-500",  icon: <CheckCircle className="w-4 h-4" /> },
  sin_datos: { label: "SIN DATOS", short: "Sin registro", tw: "text-gray-500",   bg: "bg-gray-50 border-gray-200",    ring: "ring-gray-400",   icon: <HelpCircle className="w-4 h-4" /> },
};

const OP: Record<OpStatus, { label: string; tw: string; bg: string }> = {
  servicio:    { label: "En Servicio",       tw: "text-green-700",  bg: "bg-green-100"  },
  taller:      { label: "En Taller",         tw: "text-orange-700", bg: "bg-orange-100" },
  revision:    { label: "Necesita Revisión", tw: "text-yellow-700", bg: "bg-yellow-100" },
  baja:        { label: "Fuera de Servicio", tw: "text-red-700",    bg: "bg-red-100"    },
  desconocido: { label: "Desconocido",       tw: "text-gray-500",   bg: "bg-gray-100"   },
};

const GPS_LABELS: Record<string, string> = {
  moving:            "En Movimiento",
  ack:               "ACK / Encendido",
  engine_idle:       "Ralentí",
  disconnected_red:  "Sin Señal",
  disconnected_blue: "Desconectado",
};

const STORAGE_KEY = "gps-op-status-v2";
const TAB_ORDER: Array<Category | "todos"> = ["todos", "critico", "grave", "atencion", "leve", "sin_datos", "activo"];

// ─── Animated counter ─────────────────────────────────────────────────────────

function AnimatedCount({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let cur = 0;
    const step = Math.max(1, Math.ceil(value / 24));
    const t = setInterval(() => {
      cur = Math.min(cur + step, value);
      setN(cur);
      if (cur >= value) clearInterval(t);
    }, 35);
    return () => clearInterval(t);
  }, [value]);
  return <>{n}</>;
}

// ─── Clock ────────────────────────────────────────────────────────────────────

function LiveClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return <span>{t.toLocaleString("es-VE", { timeZone: "America/Caracas" })}</span>;
}

// ─── Op status hook ───────────────────────────────────────────────────────────

function useOpData(): [OpData, (id: string, patch: Partial<OpEntry>) => void] {
  const [data, setData] = useState<OpData>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); }
    catch { return {}; }
  });
  const update = (id: string, patch: Partial<OpEntry>) => {
    setData((prev) => {
      const existing = prev[id];
      const merged: OpEntry = {
        status:    patch.status    ?? existing?.status    ?? "desconocido",
        notes:     patch.notes     ?? existing?.notes     ?? "",
        updatedAt: new Date().toISOString(),
      };
      const next = { ...prev, [id]: merged };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };
  return [data, update];
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ cat, count, active, onClick }: {
  cat: Category; count: number; active: boolean; onClick: () => void;
}) {
  const m = CAT[cat];
  return (
    <button
      onClick={onClick}
      className={`relative overflow-hidden rounded-xl border-2 p-4 text-left w-full transition-all duration-200
        hover:shadow-lg hover:-translate-y-0.5
        ${active ? `${m.bg} ring-2 ${m.ring} shadow-md -translate-y-0.5` : "bg-white border-gray-200"}`}
    >
      <div className={`flex items-center gap-1.5 mb-2 ${m.tw}`}>
        {m.icon}
        <span className="text-[11px] font-black uppercase tracking-wider">{m.label}</span>
      </div>
      <div className={`text-4xl font-black ${m.tw}`}><AnimatedCount value={count} /></div>
      <div className="text-[11px] text-gray-400 mt-1">{m.short}</div>
      {active && <div className={`absolute bottom-0 left-0 right-0 h-1 ${m.tw.replace("text-", "bg-")}`} />}
    </button>
  );
}

// ─── Op status dropdown ───────────────────────────────────────────────────────

function StatusDropdown({ deviceId, current, onUpdate }: {
  deviceId: string; current: OpStatus; onUpdate: (id: string, p: Partial<OpEntry>) => void;
}) {
  const [open, setOpen] = useState(false);
  const m = OP[current];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${m.bg} ${m.tw} hover:opacity-80 transition-opacity whitespace-nowrap`}
      >
        {m.label}<ChevronDown className="w-3 h-3 ml-0.5 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 top-8 left-0 bg-white rounded-xl shadow-xl border border-gray-200 py-1 min-w-48">
            {(Object.keys(OP) as OpStatus[]).map((s) => {
              const sm = OP[s];
              return (
                <button key={s} className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-50 transition-colors ${sm.tw} font-semibold`}
                  onClick={() => { onUpdate(deviceId, { status: s }); setOpen(false); }}>
                  {sm.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function Reportes() {
  const [tab, setTab]             = useState<Category | "todos">("todos");
  const [search, setSearch]       = useState("");
  const [exporting, setExporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [opData, updateOp]        = useOpData();

  const { data, isLoading, error, refetch, isFetching } = useQuery<ReportDevice[]>({
    queryKey: ["reports-data"],
    queryFn:  () => fetch("/api/reports/data").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const counts = useMemo(() => {
    const r: Record<string, number> = { todos: data?.length ?? 0 };
    data?.forEach((d) => { r[d.category] = (r[d.category] ?? 0) + 1; });
    return r as Record<Category | "todos", number>;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = tab === "todos" ? data : data.filter((d) => d.category === tab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((d) =>
        d.plate.toLowerCase().includes(q) ||
        d.name.toLowerCase().includes(q) ||
        (d.clientName ?? "").toLowerCase().includes(q) ||
        d.imei.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => (b.daysSinceContact ?? -1) - (a.daysSinceContact ?? -1));
  }, [data, tab, search]);

  async function exportExcel() {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch("/api/reports/excel", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ statusData: opData }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `Reporte_Fallas_GPS_${new Date().toISOString().split("T")[0]}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Error al generar el reporte. Intente nuevamente.");
    } finally {
      setExporting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Top bar ── */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shrink-0 shadow-lg">
        <div className="flex items-center gap-3">
          <img src="/logo-gps.png" alt="GPS SISTEMA C.A." className="h-10 w-10 rounded-xl object-contain bg-white p-0.5 shadow" />
          <div>
            <h1 className="font-black text-base leading-tight tracking-tight">GPS SISTEMA C.A.</h1>
            <p className="text-slate-400 text-[11px] font-medium tracking-widest uppercase">Reporte de Fallas</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-slate-400 text-xs font-mono hidden sm:block"><LiveClock /></div>
          {isFetching && (
            <span className="flex items-center gap-1 text-xs text-blue-300">
              <RefreshCw className="w-3 h-3 animate-spin" /> Actualizando
            </span>
          )}
          <button onClick={() => refetch()} disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-40">
            <RefreshCw className="w-3.5 h-3.5" /> Actualizar
          </button>
          <button onClick={exportExcel} disabled={exporting}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-green-500 hover:bg-green-400 text-white text-xs font-bold shadow transition-all disabled:opacity-50">
            {exporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            {exporting ? "Generando…" : "Exportar Excel"}
          </button>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="w-14 h-14 rounded-full border-4 border-blue-200 border-t-blue-500 animate-spin" />
            <p className="text-gray-500 text-sm animate-pulse">Consultando flota completa desde la plataforma GPS…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-red-500">
            <XCircle className="w-10 h-10" />
            <p className="font-semibold text-sm">No se pudo cargar el reporte</p>
            <button onClick={() => refetch()} className="text-xs text-blue-500 underline">Reintentar</button>
          </div>
        )}

        {data && (
          <>
            {/* ── Alert banner ── */}
            {((counts["critico"] ?? 0) > 0 || (counts["grave"] ?? 0) > 0) && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 animate-pulse" />
                <div className="text-sm font-semibold leading-relaxed">
                  {(counts["critico"] ?? 0) > 0 && (
                    <span>⚠️ <strong>{counts["critico"]}</strong> vehículo(s) CRÍTICO(S) — sin conexión más de 90 días. </span>
                  )}
                  {(counts["grave"] ?? 0) > 0 && (
                    <span>🟠 <strong>{counts["grave"]}</strong> vehículo(s) con 31–90 días sin señal.</span>
                  )}
                  <span className="font-normal"> Se requiere atención inmediata.</span>
                </div>
              </div>
            )}

            {/* ── Stat cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {(["critico", "grave", "atencion", "leve", "activo", "sin_datos"] as Category[]).map((cat) => (
                <StatCard key={cat} cat={cat} count={counts[cat] ?? 0}
                  active={tab === cat}
                  onClick={() => setTab(tab === cat ? "todos" : cat)} />
              ))}
            </div>

            {/* ── Filter bar ── */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Filter className="w-4 h-4 text-gray-400 shrink-0" />
                {TAB_ORDER.map((t) => {
                  const label = t === "todos" ? "Todos" : CAT[t].label;
                  const c     = counts[t] ?? 0;
                  const m     = t !== "todos" ? CAT[t] : null;
                  return (
                    <button key={t} onClick={() => setTab(t)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all
                        ${tab === t
                          ? (m ? `${m.bg} ${m.tw} border-current ring-1 ${m.ring}` : "bg-slate-900 text-white border-slate-900")
                          : "bg-gray-100 text-gray-600 border-transparent hover:bg-gray-200"
                        }`}
                    >
                      {label} <span className="opacity-60">({c})</span>
                    </button>
                  );
                })}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por placa, vehículo, cliente o IMEI…"
                  className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {/* ── Table ── */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">
                  {filtered.length} unidad(es) mostrada(s)
                </span>
                <span className="text-xs text-gray-400">Actualización automática cada 60 s</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                      <th className="px-3 py-3 text-left w-8">#</th>
                      <th className="px-3 py-3 text-left">Placa</th>
                      <th className="px-3 py-3 text-left">Vehículo</th>
                      <th className="px-3 py-3 text-left">Cliente</th>
                      <th className="px-3 py-3 text-left">Último Contacto</th>
                      <th className="px-3 py-3 text-center">Días</th>
                      <th className="px-3 py-3 text-left">Categoría</th>
                      <th className="px-3 py-3 text-left">Estado Operacional</th>
                      <th className="px-3 py-3 text-left">Observaciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-16 text-center text-gray-400">
                          <CheckCircle className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                          <p className="text-sm">No hay vehículos en esta categoría</p>
                        </td>
                      </tr>
                    ) : filtered.map((device, idx) => {
                      const op      = opData[device.deviceId];
                      const opSt: OpStatus = op?.status ?? "desconocido";
                      const m       = CAT[device.category];
                      const isEditing = editingId === device.deviceId;

                      return (
                        <tr key={device.deviceId}
                          className={`hover:bg-gray-50 transition-colors
                            ${device.category === "critico" ? "bg-red-50/40" : ""}
                            ${device.category === "grave"   ? "bg-orange-50/30" : ""}
                          `}>
                          <td className="px-3 py-2.5 text-gray-400 text-xs font-mono">{idx + 1}</td>

                          <td className="px-3 py-2.5">
                            <span className="font-black font-mono text-gray-900 text-sm tracking-wide">
                              {device.plate || "—"}
                            </span>
                          </td>

                          <td className="px-3 py-2.5 max-w-[200px]">
                            <p className="font-semibold text-gray-800 text-xs truncate" title={device.name}>{device.name}</p>
                            {device.imei && <p className="text-gray-400 text-[10px] font-mono">{device.imei}</p>}
                          </td>

                          <td className="px-3 py-2.5">
                            {device.clientName
                              ? <div>
                                  <p className="text-xs font-semibold text-gray-700">{device.clientName}</p>
                                  {device.clientPhone && <p className="text-[10px] text-gray-400">{device.clientPhone}</p>}
                                </div>
                              : <span className="text-[10px] text-gray-300 italic">Sin asignar</span>
                            }
                          </td>

                          <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[140px]">
                            <span className="block truncate" title={device.lastConnection}>
                              {device.lastConnection || "—"}
                            </span>
                          </td>

                          <td className="px-3 py-2.5 text-center">
                            {device.daysSinceContact !== null
                              ? <span className={`font-black text-lg ${m.tw}`}>
                                  {device.daysSinceContact}
                                  <span className="text-xs font-normal ml-0.5">d</span>
                                </span>
                              : <span className="text-gray-300 text-xs">—</span>
                            }
                          </td>

                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${m.bg} ${m.tw}`}>
                              {m.icon}{m.label}
                            </span>
                          </td>

                          <td className="px-3 py-2.5">
                            <StatusDropdown deviceId={device.deviceId} current={opSt} onUpdate={updateOp} />
                          </td>

                          <td className="px-3 py-2.5 min-w-[140px]">
                            {isEditing ? (
                              <input autoFocus
                                defaultValue={op?.notes ?? ""}
                                onBlur={(e) => { updateOp(device.deviceId, { notes: e.target.value }); setEditingId(null); }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                className="w-full text-xs border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                placeholder="Escribir nota…"
                              />
                            ) : (
                              <button onClick={() => setEditingId(device.deviceId)}
                                className="text-xs text-gray-400 hover:text-blue-600 hover:underline text-left block w-full max-w-[140px] truncate"
                                title={op?.notes || "Clic para agregar nota"}>
                                {op?.notes
                                  ? <span className="text-gray-700">{op.notes}</span>
                                  : <span className="italic text-gray-300">+ agregar nota</span>
                                }
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Table footer */}
              <div className="px-5 py-3 border-t border-gray-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-4 flex-wrap">
                  {(Object.keys(OP) as OpStatus[]).map((s) => {
                    const m = OP[s];
                    return (
                      <div key={s} className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold ${m.bg} ${m.tw}`}>
                        {s === "servicio"    && <CheckCircle className="w-3 h-3" />}
                        {s === "taller"      && <Wrench className="w-3 h-3" />}
                        {s === "revision"    && <AlertTriangle className="w-3 h-3" />}
                        {s === "baja"        && <XCircle className="w-3 h-3" />}
                        {s === "desconocido" && <HelpCircle className="w-3 h-3" />}
                        {m.label}
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <Activity className="w-3 h-3" /> Estado guardado en el navegador
                  </div>
                </div>
                <button onClick={exportExcel} disabled={exporting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-bold shadow transition-all disabled:opacity-50">
                  <Download className="w-3.5 h-3.5" />
                  {exporting ? "Generando…" : "Exportar Excel"}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
