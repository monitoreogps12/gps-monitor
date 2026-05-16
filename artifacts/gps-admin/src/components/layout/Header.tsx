import { useEffect, useState } from "react";
import { useGetConnectionStatus, getGetConnectionStatusQueryKey } from "@workspace/api-client-react";

export function Header() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const { data: connectionStatus } = useGetConnectionStatus({
    query: {
      refetchInterval: 30000,
      queryKey: getGetConnectionStatusQueryKey()
    }
  });

  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-foreground">Visión General</h2>
        {connectionStatus && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-background border border-border">
            <div 
              className="w-2 h-2 rounded-full" 
              style={{ backgroundColor: connectionStatus.connected ? "#22c55e" : "#ef4444" }} 
            />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {connectionStatus.connected ? "Conectado" : "Desconectado"}
            </span>
          </div>
        )}
      </div>
      <div className="font-mono text-sm text-muted-foreground font-medium bg-background px-4 py-1.5 rounded-md border border-border">
        {time.toLocaleTimeString('es-VE')}
      </div>
    </header>
  );
}
