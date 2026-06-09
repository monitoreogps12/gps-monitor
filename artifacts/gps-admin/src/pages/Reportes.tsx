import { useState, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle, WifiOff, Clock, CheckCircle, HelpCircle,
  Download, Search, Wrench, XCircle, Activity, ChevronDown,
  Filter, FileSpreadsheet, Upload, RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = "activo" | "leve" | "atencion" | "grave" | "critico" | "sin_datos";
type OpStatus  = "servicio" | "taller" | "revision" | "baja" | "desconocido";

interface VehicleRow {
  id: string;
  name: string;
  plate: string;
  imei: string;
  lastConnection: string;
  daysSinceContact: number | null;
  category: Category;
  clientName: string | null;
  rawStatus: string;
}

interface OpEntry { status: OpStatus; notes: string; }
type OpData = Record<string, OpEntry>;

// ─── Category metadata ────────────────────────────────────────────────────────

const CAT: Record<Category, {
  label: string; short: string; tw: string; bg: string; border: string; ring: string; icon: React.ReactNode;
}> = {
  critico:   { label: "CRÍTICO",   short: ">90 días",     tw: "text-red-600",    bg: "bg-red-50",    border: "border-red-200",    ring: "ring-red-500",    icon: <XCircle className="w-4 h-4" /> },
  grave:     { label: "GRAVE",     short: "31–90 días",   tw: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200", ring: "ring-orange-500", icon: <AlertTriangle className="w-4 h-4" /> },
  atencion:  { label: "ATENCIÓN",  short: "7–30 días",    tw: "text-yellow-600", bg: "bg-yellow-50", border: "border-yellow-200", ring: "ring-yellow-500", icon: <Clock className="w-4 h-4" /> },
  leve:      { label: "LEVE",      short: "1–6 días",     tw: "text-blue-600",   bg: "bg-blue-50",   border: "border-blue-200",   ring: "ring-blue-500",   icon: <WifiOff className="w-4 h-4" /> },
  activo:    { label: "ACTIVO",    short: "En línea",     tw: "text-green-600",  bg: "bg-green-50",  border: "border-green-200",  ring: "ring-green-500",  icon: <CheckCircle className="w-4 h-4" /> },
  sin_datos: { label: "SIN DATOS", short: "Sin fecha",    tw: "text-gray-500",   bg: "bg-gray-50",   border: "border-gray-200",   ring: "ring-gray-400",   icon: <HelpCircle className="w-4 h-4" /> },
};

const OP: Record<OpStatus, { label: string; tw: string; bg: string }> = {
  servicio:    { label: "En Servicio",       tw: "text-green-700",  bg: "bg-green-100"  },
  taller:      { label: "En Taller",         tw: "text-orange-700", bg: "bg-orange-100" },
  revision:    { label: "Necesita Revisión", tw: "text-yellow-700", bg: "bg-yellow-100" },
  baja:        { label: "Fuera de Servicio", tw: "text-red-700",    bg: "bg-red-100"    },
  desconocido: { label: "Desconocido",       tw: "text-gray-500",   bg: "bg-gray-100"   },
};

const STORAGE_KEY = "gps-op-status-v2";
const TAB_ORDER: Array<Category | "todos"> = ["todos", "critico", "grave", "atencion", "leve", "sin_datos", "activo"];

// ─── Date parsing ─────────────────────────────────────────────────────────────

function parseDate(s: string): Date | null {
  if (!s || s.trim() === "") return null;
  try {
    // ISO / standard JS parseable
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    // DD-MM-YYYY HH:MM:SS AM/PM  (platform format)
    const m = s.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(AM|PM)/i);
    if (m) {
      let h = parseInt(m[4]!);
      if (m[7]!.toUpperCase() === "PM" && h < 12) h += 12;
      if (m[7]!.toUpperCase() === "AM" && h === 12) h = 0;
      return new Date(parseInt(m[3]!), parseInt(m[2]!) - 1, parseInt(m[1]!), h, parseInt(m[5]!), parseInt(m[6]!));
    }
    // DD/MM/YYYY
    const m2 = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m2) return new Date(parseInt(m2[3]!), parseInt(m2[2]!) - 1, parseInt(m2[1]!));
    return null;
  } catch { return null; }
}

function daysSince(d: Date | null): number | null {
  if (!d) return null;
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  return diff >= 0 ? diff : null;
}

function getCategory(days: number | null): Category {
  if (days === null) return "sin_datos";
  if (days <= 1)  return "activo";
  if (days <= 6)  return "leve";
  if (days <= 30) return "atencion";
  if (days <= 90) return "grave";
  return "critico";
}

// ─── Excel column detection ───────────────────────────────────────────────────

function findCol(keys: string[], ...patterns: string[]): string | undefined {
  return keys.find((k) => patterns.some((p) => k.toLowerCase().includes(p.toLowerCase())));
}

function processExcelRows(rows: Record<string, unknown>[]): VehicleRow[] {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]!);

  const nameCol       = findCol(keys, "name", "nombre", "descripci", "device", "unit", "vehiculo", "objeto");
  const plateCol      = findCol(keys, "plate", "placa", "matricula", "patente", "license");
  const lastConnCol   = findCol(keys, "last", "connection", "conexion", "fecha", "date", "time", "ultima", "contact");
  const imeiCol       = findCol(keys, "imei");
  const statusCol     = findCol(keys, "status", "estado", "online", "stat");
  const clientCol     = findCol(keys, "client", "cliente", "owner", "propietario", "empresa");

  return rows.map((row, i) => {
    const lastStr = lastConnCol ? String(row[lastConnCol] ?? "") : "";
    const lastDate = parseDate(lastStr);
    const days = daysSince(lastDate);

    return {
      id:               String(i),
      name:             nameCol   ? String(row[nameCol]   ?? `Vehículo ${i + 1}`) : `Vehículo ${i + 1}`,
      plate:            plateCol  ? String(row[plateCol]  ?? "")                  : "",
      imei:             imeiCol   ? String(row[imeiCol]   ?? "")                  : "",
      lastConnection:   lastStr,
      daysSinceContact: days,
      category:         getCategory(days),
      clientName:       clientCol ? String(row[clientCol] ?? "") || null          : null,
      rawStatus:        statusCol ? String(row[statusCol] ?? "")                  : "",
    };
  });
}

// ─── Op status hook ───────────────────────────────────────────────────────────

function useOpData(): [OpData, (id: string, patch: Partial<OpEntry>) => void, () => void] {
  const [data, setData] = useState<OpData>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); }
    catch { return {}; }
  });
  const update = (id: string, patch: Partial<OpEntry>) => {
    setData((prev) => {
      const existing = prev[id];
      const merged: OpEntry = {
        status: patch.status ?? existing?.status ?? "desconocido",
        notes:  patch.notes  ?? existing?.notes  ?? "",
      };
      const next = { ...prev, [id]: merged };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };
  const clear = () => {
    setData({});
    localStorage.removeItem(STORAGE_KEY);
  };
  return [data, update, clear];
}

// ─── Status dropdown ──────────────────────────────────────────────────────────

function StatusDropdown({ id, current, onUpdate }: {
  id: string; current: OpStatus; onUpdate: (id: string, p: Partial<OpEntry>) => void;
}) {
  const [open, setOpen] = useState(false);
  const m = OP[current];
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${m.bg} ${m.tw} hover:opacity-80 whitespace-nowrap`}>
        {m.label}<ChevronDown className="w-3 h-3 ml-0.5 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 top-8 left-0 bg-white rounded-xl shadow-xl border border-gray-200 py-1 min-w-48">
            {(Object.keys(OP) as OpStatus[]).map((s) => (
              <button key={s} onClick={() => { onUpdate(id, { status: s }); setOpen(false); }}
                className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-50 ${OP[s].tw} font-semibold`}>
                {OP[s].label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Animated counter ─────────────────────────────────────────────────────────

function Count({ n }: { n: number }) {
  return <>{n}</>;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Reportes() {
  const [vehicles, setVehicles]   = useState<VehicleRow[]>([]);
  const [fileName, setFileName]   = useState<string>("");
  const [tab, setTab]             = useState<Category | "todos">("todos");
  const [search, setSearch]       = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging]   = useState(false);
  const fileInputRef              = useRef<HTMLInputElement>(null);
  const [opData, updateOp, clearOp] = useOpData();

  // ── Excel import ────────────────────────────────────────────────────────────

  const loadFile = useCallback((file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb   = XLSX.read(data, { type: "array", cellDates: true });
        const ws   = wb.Sheets[wb.SheetNames[0]!]!;
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false, defval: "" });
        const processed = processExcelRows(rows);
        setVehicles(processed);
        setFileName(file.name);
        setTab("todos");
        setSearch("");
      } catch {
        alert("No se pudo leer el archivo. Asegúrese de que sea un Excel válido (.xlsx o .xls).");
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  };

  const handleReset = () => {
    setVehicles([]);
    setFileName("");
    setTab("todos");
    setSearch("");
    clearOp();
  };

  // ── Counts & filter ──────────────────────────────────────────────────────────

  const counts = useMemo(() => {
    const r: Record<string, number> = { todos: vehicles.length };
    vehicles.forEach((v) => { r[v.category] = (r[v.category] ?? 0) + 1; });
    return r as Record<Category | "todos", number>;
  }, [vehicles]);

  const filtered = useMemo(() => {
    let list = tab === "todos" ? vehicles : vehicles.filter((v) => v.category === tab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((v) =>
        v.plate.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        (v.clientName ?? "").toLowerCase().includes(q) ||
        v.imei.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => (b.daysSinceContact ?? -1) - (a.daysSinceContact ?? -1));
  }, [vehicles, tab, search]);

  // ── Excel export ─────────────────────────────────────────────────────────────

  async function exportExcel() {
    if (exporting || !vehicles.length) return;
    setExporting(true);
    try {
      const statusData: Record<string, { status: string; notes: string }> = {};
      Object.entries(opData).forEach(([id, entry]) => {
        statusData[id] = { status: entry.status, notes: entry.notes };
      });
      const payload = vehicles.map((v) => {
        const op = opData[v.id];
        return {
          Placa:               v.plate      || "—",
          Vehículo:            v.name,
          IMEI:                v.imei       || "—",
          Cliente:             v.clientName ?? "Sin asignar",
          "Último Contacto":   v.lastConnection || "—",
          "Días Sin Señal":    v.daysSinceContact !== null ? v.daysSinceContact : "—",
          Categoría:           CAT[v.category].label,
          "Estado Operacional": op ? OP[op.status]?.label ?? "Desconocido" : "Desconocido",
          Observaciones:       op?.notes ?? "",
        };
      });
      const res = await fetch("/api/reports/excel-import", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rows: payload }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = `Reporte_Fallas_GPS_${new Date().toISOString().split("T")[0]}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // Fallback: simple CSV-like export via XLSX
        const wb  = XLSX.utils.book_new();
        const ws  = XLSX.utils.json_to_sheet(payload);
        XLSX.utils.book_append_sheet(wb, ws, "Reporte de Fallas");
        XLSX.writeFile(wb, `Reporte_Fallas_GPS_${new Date().toISOString().split("T")[0]}.xlsx`);
      }
    } catch {
      alert("Error al exportar. Intente de nuevo.");
    } finally {
      setExporting(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BLANK STATE — upload area
  // ─────────────────────────────────────────────────────────────────────────────

  if (!vehicles.length) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Top bar */}
        <header className="bg-slate-900 text-white px-6 py-3 flex items-center gap-3 shadow-lg">
          <img src="/logo-gps.png" alt="GPS SISTEMA C.A." className="h-10 w-10 rounded-xl object-contain bg-white p-0.5 shadow" />
          <div>
            <h1 className="font-black text-base leading-tight">GPS SISTEMA C.A.</h1>
            <p className="text-slate-400 text-[11px] font-medium tracking-widest uppercase">Reporte de Fallas</p>
          </div>
        </header>

        {/* Upload zone */}
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg w-full text-center space-y-6">
            <div className="flex justify-center">
              <img src="/logo-gps.png" alt="GPS SISTEMA C.A." className="w-24 h-24 object-contain" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-900">Reporte de Fallas</h2>
              <p className="text-gray-500 mt-1 text-sm">Cargue el archivo Excel con la lista de vehículos para comenzar</p>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-2xl p-12 cursor-pointer transition-all duration-200
                flex flex-col items-center gap-4
                ${dragging
                  ? "border-blue-400 bg-blue-50 scale-[1.02]"
                  : "border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/40"
                }
              `}
            >
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors ${dragging ? "bg-blue-500" : "bg-gray-100"}`}>
                <Upload className={`w-8 h-8 ${dragging ? "text-white" : "text-gray-400"}`} />
              </div>
              <div>
                <p className="font-semibold text-gray-700 text-base">
                  {dragging ? "Suelte el archivo aquí" : "Arrastra el Excel aquí"}
                </p>
                <p className="text-gray-400 text-sm mt-1">o haz clic para seleccionar el archivo</p>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors">
                <FileSpreadsheet className="w-4 h-4" />
                Seleccionar archivo Excel
              </div>
              <p className="text-xs text-gray-400">Soporta .xlsx y .xls</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileInput}
            />

            {/* Legend */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              {(["critico","grave","atencion","leve","activo","sin_datos"] as Category[]).map((c) => {
                const m = CAT[c];
                return (
                  <div key={c} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border ${m.bg} ${m.border}`}>
                    <span className={m.tw}>{m.icon}</span>
                    <div>
                      <p className={`font-bold ${m.tw}`}>{m.label}</p>
                      <p className="text-gray-400">{m.short}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DATA STATE — reports table
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Top bar */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shrink-0 shadow-lg">
        <div className="flex items-center gap-3">
          <img src="/logo-gps.png" alt="GPS SISTEMA C.A." className="h-10 w-10 rounded-xl object-contain bg-white p-0.5 shadow" />
          <div>
            <h1 className="font-black text-base leading-tight">GPS SISTEMA C.A.</h1>
            <p className="text-slate-400 text-[11px] font-medium tracking-widest uppercase">Reporte de Fallas</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-500 text-xs hidden sm:block truncate max-w-[200px]" title={fileName}>
            📂 {fileName}
          </span>
          <button onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors">
            <Upload className="w-3.5 h-3.5" /> Cambiar archivo
          </button>
          <button onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-red-400 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Limpiar
          </button>
          <button onClick={exportExcel} disabled={exporting}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-green-500 hover:bg-green-400 text-white text-xs font-bold shadow transition-all disabled:opacity-50">
            {exporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            {exporting ? "Generando…" : "Exportar Excel"}
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileInput} />
      </header>

      <main className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Alert banner */}
        {((counts["critico"] ?? 0) > 0 || (counts["grave"] ?? 0) > 0) && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 animate-pulse" />
            <p className="text-sm font-semibold">
              {(counts["critico"] ?? 0) > 0 && <span>⚠️ <strong>{counts["critico"]}</strong> vehículo(s) CRÍTICO(S) — más de 90 días sin conexión. </span>}
              {(counts["grave"] ?? 0) > 0 && <span>🟠 <strong>{counts["grave"]}</strong> vehículo(s) con 31–90 días sin señal. </span>}
              <span className="font-normal">Se requiere atención inmediata.</span>
            </p>
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {(["critico","grave","atencion","leve","activo","sin_datos"] as Category[]).map((cat) => {
            const m = CAT[cat];
            const count = counts[cat] ?? 0;
            const isActive = tab === cat;
            return (
              <button key={cat} onClick={() => setTab(isActive ? "todos" : cat)}
                className={`relative overflow-hidden rounded-xl border-2 p-4 text-left w-full transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5
                  ${isActive ? `${m.bg} ${m.border} ring-2 ${m.ring} shadow-md -translate-y-0.5` : "bg-white border-gray-200"}`}>
                <div className={`flex items-center gap-1.5 mb-2 ${m.tw}`}>
                  {m.icon}
                  <span className="text-[11px] font-black uppercase tracking-wider">{m.label}</span>
                </div>
                <div className={`text-4xl font-black ${m.tw}`}><Count n={count} /></div>
                <div className="text-[11px] text-gray-400 mt-1">{m.short}</div>
                {isActive && <div className={`absolute bottom-0 left-0 right-0 h-1 ${m.tw.replace("text-","bg-")}`} />}
              </button>
            );
          })}
        </div>

        {/* Filter bar */}
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
                      ? (m ? `${m.bg} ${m.tw} ${m.border} ring-1 ${m.ring}` : "bg-slate-900 text-white border-slate-900")
                      : "bg-gray-100 text-gray-600 border-transparent hover:bg-gray-200"
                    }`}>
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

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">{filtered.length} unidad(es) mostrada(s)</span>
            <span className="text-xs text-gray-400">{vehicles.length} total importadas</span>
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
                ) : filtered.map((v, idx) => {
                  const op    = opData[v.id];
                  const opSt  = op?.status ?? "desconocido";
                  const m     = CAT[v.category];
                  const isEd  = editingId === v.id;

                  return (
                    <tr key={v.id}
                      className={`hover:bg-gray-50 transition-colors
                        ${v.category === "critico" ? "bg-red-50/40" : ""}
                        ${v.category === "grave"   ? "bg-orange-50/25" : ""}`}>
                      <td className="px-3 py-2.5 text-gray-400 text-xs font-mono">{idx + 1}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-black font-mono text-gray-900 text-sm">{v.plate || "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 max-w-[220px]">
                        <p className="font-semibold text-gray-800 text-xs truncate" title={v.name}>{v.name}</p>
                        {v.imei && <p className="text-gray-400 text-[10px] font-mono">{v.imei}</p>}
                      </td>
                      <td className="px-3 py-2.5">
                        {v.clientName
                          ? <p className="text-xs font-semibold text-gray-700">{v.clientName}</p>
                          : <span className="text-[10px] text-gray-300 italic">Sin asignar</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[140px]">
                        <span className="block truncate" title={v.lastConnection}>{v.lastConnection || "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {v.daysSinceContact !== null
                          ? <span className={`font-black text-lg ${m.tw}`}>{v.daysSinceContact}<span className="text-xs font-normal ml-0.5">d</span></span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${m.bg} ${m.border} ${m.tw}`}>
                          {m.icon}{m.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusDropdown id={v.id} current={opSt} onUpdate={updateOp} />
                      </td>
                      <td className="px-3 py-2.5 min-w-[140px]">
                        {isEd ? (
                          <input autoFocus defaultValue={op?.notes ?? ""}
                            onBlur={(e) => { updateOp(v.id, { notes: e.target.value }); setEditingId(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditingId(null); }}
                            className="w-full text-xs border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="Escribir nota…" />
                        ) : (
                          <button onClick={() => setEditingId(v.id)}
                            className="text-xs text-left block w-full max-w-[140px] truncate hover:underline"
                            title={op?.notes || "Clic para agregar nota"}>
                            {op?.notes
                              ? <span className="text-gray-700">{op.notes}</span>
                              : <span className="italic text-gray-300">+ agregar nota</span>}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-gray-100 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              {(Object.keys(OP) as OpStatus[]).map((s) => {
                const m = OP[s];
                return (
                  <div key={s} className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${m.bg} ${m.tw}`}>
                    {s === "servicio"    && <CheckCircle className="w-3 h-3" />}
                    {s === "taller"      && <Wrench className="w-3 h-3" />}
                    {s === "revision"    && <AlertTriangle className="w-3 h-3" />}
                    {s === "baja"        && <XCircle className="w-3 h-3" />}
                    {s === "desconocido" && <HelpCircle className="w-3 h-3" />}
                    {m.label}
                  </div>
                );
              })}
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                <Activity className="w-3 h-3" /> Estado guardado en el navegador
              </span>
            </div>
            <button onClick={exportExcel} disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-bold shadow transition-all disabled:opacity-50">
              <Download className="w-3.5 h-3.5" />
              {exporting ? "Generando…" : "Exportar Excel"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
