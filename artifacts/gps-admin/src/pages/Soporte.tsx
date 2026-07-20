import { useState } from "react";
import { useListDevices, getListDevicesQueryKey } from "@workspace/api-client-react";
import { Search, Cpu } from "lucide-react";
import { getStatusColor, getStatusLabel, DeviceStatus } from "@/lib/status-colors";

const TABS: { value: string; label: string; color: string }[] = [
  { value: "all",              label: "Todos",       color: "#94a3b8" },
  { value: "moving",           label: "Movimiento",  color: "#22c55e" },
  { value: "disconnected_blue",label: "Desc.",       color: "#3b82f6" },
  { value: "disconnected_red", label: "Sin Señal",   color: "#ef4444" },
  { value: "ack",              label: "ACK",         color: "#eab308" },
  { value: "engine_idle",      label: "Ralentí",     color: "#f97316" },
];

export function Soporte() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: devices, isLoading } = useListDevices({
    query: { refetchInterval: 10000, queryKey: getListDevicesQueryKey() },
  });

  const counts = devices?.reduce((acc, dev) => {
    acc[dev.status] = (acc[dev.status] || 0) + 1;
    acc.all = (acc.all || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const filteredDevices = devices?.filter(device => {
    const matchesSearch =
      device.plate.toLowerCase().includes(search.toLowerCase()) ||
      device.name.toLowerCase().includes(search.toLowerCase()) ||
      device.imei.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || device.status === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];

  return (
    <div className="flex flex-col gap-5 h-[calc(100vh-100px)]">

      {/* ── Header bar ── */}
      <div
        className="rounded-2xl px-5 py-4 flex items-center justify-between relative overflow-hidden shrink-0"
        style={{
          background: "linear-gradient(135deg, #0A1A3E 0%, #0D2255 60%, #0A1A3E 100%)",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 6px 32px rgba(10,26,62,0.4)",
        }}
      >
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full pointer-events-none opacity-20"
          style={{ background: "radial-gradient(circle, #1E6FBF 0%, transparent 70%)", transform: "translate(40%,-40%)" }} />
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(30,111,191,0.2)", border: "1px solid rgba(30,111,191,0.3)" }}>
            <Cpu className="w-4.5 h-4.5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-base font-black text-white">Soporte Técnico</h1>
            <p className="text-[11px] text-white/40">Gestión y monitoreo detallado de dispositivos</p>
          </div>
        </div>
        <div className="relative z-10 text-center">
          <div className="text-3xl font-black text-white tabular-nums">{counts.all || 0}</div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/35">Dispositivos</div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col xl:flex-row gap-3 shrink-0">
        {/* Search */}
        <div className="relative w-full xl:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            placeholder="Buscar por placa, nombre o IMEI..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl outline-none transition-all text-white placeholder:text-white/30"
            style={{
              background: "rgba(10,26,62,0.7)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            onFocus={e => (e.target.style.borderColor = "rgba(232,114,12,0.5)")}
            onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
          />
        </div>

        {/* Status tabs */}
        <div className="flex flex-wrap gap-2">
          {TABS.map(tab => {
            const active = statusFilter === tab.value;
            const count = tab.value === "all" ? (counts.all || 0) : (counts[tab.value] || 0);
            return (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
                style={active ? {
                  background: `${tab.color}22`,
                  border: `1px solid ${tab.color}55`,
                  color: tab.color,
                  boxShadow: `0 0 12px ${tab.color}22`,
                } : {
                  background: "rgba(10,26,62,0.5)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.4)",
                }}
              >
                {tab.label}
                <span className="ml-1.5 opacity-60">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Table ── */}
      <div
        className="flex-1 overflow-auto rounded-2xl"
        style={{
          background: "linear-gradient(180deg, #0A1A3E 0%, #060E22 100%)",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 6px 32px rgba(5,10,25,0.3)",
        }}
      >
        <table className="w-full text-sm text-left">
          <thead className="sticky top-0 z-10" style={{ background: "rgba(10,26,62,0.95)", backdropFilter: "blur(8px)" }}>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {["Estado","Placa","Dispositivo","IMEI","SIM","Última Conexión"].map(h => (
                <th key={h} className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/35">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-white/30 text-sm">Cargando dispositivos…</td>
              </tr>
            ) : filteredDevices.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-white/30 text-sm">No se encontraron dispositivos</td>
              </tr>
            ) : filteredDevices.map(device => {
              const color = getStatusColor(device.status as DeviceStatus);
              return (
                <tr
                  key={device.id}
                  className="transition-colors"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: color, boxShadow: `0 0 6px ${color}88` }} />
                      <span className="text-xs font-bold" style={{ color }}>
                        {getStatusLabel(device.status as DeviceStatus)}
                        {device.status === "moving" && device.speed ? ` · ${device.speed} km/h` : ""}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-black text-white text-sm">{device.plate}</td>
                  <td className="px-4 py-3 text-white/50 text-xs">{device.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-white/40">{device.imei}</td>
                  <td className="px-4 py-3 font-mono text-xs text-white/40">{device.simNumber}</td>
                  <td className="px-4 py-3 text-white/35 text-xs">
                    {new Date(device.lastConnection).toLocaleString("es-VE")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
