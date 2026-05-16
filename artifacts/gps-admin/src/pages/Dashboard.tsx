import { useGetFleetStats, getGetFleetStatsQueryKey, useListDevices, getListDevicesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Car, WifiOff, AlertCircle, Clock, Search } from "lucide-react";
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";
import { Input } from "@/components/ui/input";

export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetFleetStats({
    query: {
      refetchInterval: 15000,
      queryKey: getGetFleetStatsQueryKey()
    }
  });

  const { data: devices, isLoading: devicesLoading } = useListDevices({
    query: {
      refetchInterval: 15000,
      queryKey: getListDevicesQueryKey()
    }
  });

  const recentDevices = devices?.slice(0, 5) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard Overview</h1>
        <p className="text-sm text-muted-foreground">
          Monitor de estado de la flota en tiempo real.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Vehículos</CardTitle>
            <Car className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statsLoading ? "-" : stats?.total || 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-green-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-500">En Movimiento</CardTitle>
            <Activity className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{statsLoading ? "-" : stats?.moving || 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-blue-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-blue-500">Desconectados</CardTitle>
            <WifiOff className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">{statsLoading ? "-" : stats?.disconnected || 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-yellow-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-yellow-500">ACK</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-500">{statsLoading ? "-" : stats?.ack || 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-orange-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-orange-500">Ralentí</CardTitle>
            <Clock className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{statsLoading ? "-" : stats?.engineIdle || 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Actividad Reciente</CardTitle>
        </CardHeader>
        <CardContent>
          {devicesLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Cargando...</div>
          ) : (
            <div className="space-y-4">
              {recentDevices.map(device => (
                <div key={device.id} className="flex items-center justify-between p-4 bg-background/50 rounded-lg border border-border">
                  <div className="flex items-center gap-4">
                    <div 
                      className="w-3 h-3 rounded-full shrink-0" 
                      style={{ backgroundColor: getStatusColor(device.status) }}
                    />
                    <div>
                      <div className="font-bold text-foreground">{device.plate}</div>
                      <div className="text-xs text-muted-foreground">{device.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium" style={{ color: getStatusColor(device.status) }}>
                      {getStatusLabel(device.status)}
                      {device.status === 'moving' && device.speed ? ` (${device.speed} km/h)` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Última conexión: {new Date(device.lastConnection).toLocaleString('es-VE')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
