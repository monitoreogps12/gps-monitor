import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGetConnectionStatus, getGetConnectionStatusQueryKey } from "@workspace/api-client-react";
import { Clock, Wifi, WifiOff } from "lucide-react";

const PAGE_TITLES: Record<string, { label: string; sub: string }> = {
  "/":         { label: "Dashboard",       sub: "Estado general de la flota en tiempo real"    },
  "/soporte":  { label: "Soporte Técnico", sub: "Gestión de tickets e incidencias"              },
  "/clientes": { label: "Clientes",        sub: "Clientes registrados y vehículos asignados"   },
  "/mapa":     { label: "Mapa en Vivo",    sub: "Ubicación en tiempo real de todos los activos" },
};

export function Header() {
  const [time, setTime] = useState(new Date());
  const [location] = useLocation();

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const { data: connectionStatus } = useGetConnectionStatus({
    query: { refetchInterval: 30000, queryKey: getGetConnectionStatusQueryKey() },
  });

  const page = PAGE_TITLES[location] ?? { label: "Panel", sub: "" };
  const connected = connectionStatus?.connected ?? null;

  return (
    <header className="bg-white border-b border-border shrink-0 shadow-sm">
      {/* Top accent line — brand gradient */}
      <div className="h-0.5 w-full brand-gradient" />

      <div className="flex items-center justify-between px-6 py-3">
        {/* Left: title */}
        <div>
          <h2 className="text-base font-black text-foreground leading-tight tracking-tight">{page.label}</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">{page.sub}</p>
        </div>

        {/* Right: status + clock */}
        <div className="flex items-center gap-3">
          {/* Connection status */}
          {connected !== null && (
            <div className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border",
              connected
                ? "bg-green-50 border-green-200 text-green-700"
                : "bg-red-50 border-red-200 text-red-700"
            )}>
              {connected
                ? <Wifi className="w-3 h-3" />
                : <WifiOff className="w-3 h-3" />}
              <div className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-green-500 animate-pulse" : "bg-red-500")} />
              {connected ? "Conectado" : "Desconectado"}
            </div>
          )}

          {/* Clock */}
          <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-lg border border-border">
            <Clock className="w-3 h-3" style={{ color: "#E8720C" }} />
            {time.toLocaleTimeString("es-VE")}
          </div>
        </div>
      </div>
    </header>
  );
}

function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
