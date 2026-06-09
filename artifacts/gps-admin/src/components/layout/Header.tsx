import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGetConnectionStatus, getGetConnectionStatusQueryKey } from "@workspace/api-client-react";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/reportes": "Reportes de Fallas",
  "/soporte": "Soporte Técnico",
  "/clientes": "Clientes",
  "/mapa": "Mapa en Vivo",
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

  const title = PAGE_TITLES[location] ?? "Panel";

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-6 shrink-0 shadow-sm">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {connectionStatus && (
          <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border",
            connectionStatus.connected
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-red-50 border-red-200 text-red-700"
          )}>
            <div className={cn("w-1.5 h-1.5 rounded-full", connectionStatus.connected ? "bg-green-500 animate-pulse" : "bg-red-500")} />
            {connectionStatus.connected ? "Conectado" : "Desconectado"}
          </div>
        )}
      </div>
      <div className="font-mono text-xs text-muted-foreground font-medium bg-muted/60 px-3 py-1.5 rounded-md border border-border">
        {time.toLocaleTimeString("es-VE")}
      </div>
    </header>
  );
}

function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
