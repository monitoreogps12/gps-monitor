import { useState } from "react";
import { useListDevices, getListDevicesQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { getStatusColor, getStatusLabel, DeviceStatus } from "@/lib/status-colors";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function Soporte() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: devices, isLoading } = useListDevices({
    query: {
      refetchInterval: 10000,
      queryKey: getListDevicesQueryKey()
    }
  });

  const filteredDevices = devices?.filter(device => {
    const matchesSearch = 
      device.plate.toLowerCase().includes(search.toLowerCase()) ||
      device.name.toLowerCase().includes(search.toLowerCase()) ||
      device.imei.toLowerCase().includes(search.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || device.status === statusFilter;

    return matchesSearch && matchesStatus;
  }) || [];

  const counts = devices?.reduce((acc, dev) => {
    acc[dev.status] = (acc[dev.status] || 0) + 1;
    acc.all = (acc.all || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-100px)]">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Soporte Técnico</h1>
          <p className="text-sm text-muted-foreground">
            Gestión y monitoreo detallado de dispositivos.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground">Total dispositivos:</span>
          <span className="bg-primary/20 text-primary px-2 py-1 rounded-md">{counts.all || 0}</span>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row gap-4 shrink-0">
        <div className="relative w-full xl:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Buscar por placa, nombre o IMEI..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-card border-border"
          />
        </div>
        <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full overflow-x-auto">
          <TabsList className="bg-card border border-border inline-flex w-full xl:w-auto h-auto p-1 flex-wrap">
            <TabsTrigger value="all" className="flex-1 sm:flex-none">Todos ({counts.all || 0})</TabsTrigger>
            <TabsTrigger value="moving" className="flex-1 sm:flex-none text-green-500 data-[state=active]:text-green-500">
              Movimiento ({counts.moving || 0})
            </TabsTrigger>
            <TabsTrigger value="disconnected_blue" className="flex-1 sm:flex-none text-blue-500 data-[state=active]:text-blue-500">
              Desc ({counts.disconnected_blue || 0})
            </TabsTrigger>
            <TabsTrigger value="disconnected_red" className="flex-1 sm:flex-none text-red-500 data-[state=active]:text-red-500">
              Sin Señal ({counts.disconnected_red || 0})
            </TabsTrigger>
            <TabsTrigger value="ack" className="flex-1 sm:flex-none text-yellow-500 data-[state=active]:text-yellow-500">
              ACK ({counts.ack || 0})
            </TabsTrigger>
            <TabsTrigger value="engine_idle" className="flex-1 sm:flex-none text-orange-500 data-[state=active]:text-orange-500">
              Ralentí ({counts.engine_idle || 0})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-background/50 sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-background/50">
            <tr>
              <th className="px-4 py-3 font-medium border-b border-border">Estado</th>
              <th className="px-4 py-3 font-medium border-b border-border">Placa</th>
              <th className="px-4 py-3 font-medium border-b border-border">Dispositivo</th>
              <th className="px-4 py-3 font-medium border-b border-border">IMEI</th>
              <th className="px-4 py-3 font-medium border-b border-border">SIM</th>
              <th className="px-4 py-3 font-medium border-b border-border">Última Conexión</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Cargando dispositivos...
                </td>
              </tr>
            ) : filteredDevices.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No se encontraron dispositivos
                </td>
              </tr>
            ) : (
              filteredDevices.map(device => (
                <tr key={device.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: getStatusColor(device.status) }}
                        title={getStatusLabel(device.status)}
                      />
                      <span className="text-xs font-medium whitespace-nowrap" style={{ color: getStatusColor(device.status) }}>
                        {getStatusLabel(device.status)}
                        {device.status === 'moving' && device.speed ? ` (${device.speed} km/h)` : ''}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-bold text-foreground">{device.plate}</td>
                  <td className="px-4 py-3 text-muted-foreground">{device.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{device.imei}</td>
                  <td className="px-4 py-3 font-mono text-xs">{device.simNumber}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(device.lastConnection).toLocaleString('es-VE')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
