import { useState, useMemo } from "react";
import {
  useListClients,
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
  useAddClientVehicle,
  useRemoveClientVehicle,
  useNotifyClientAssignment,
  useListDevices,
  useGetLivePositions,
  getListClientsQueryKey,
  getListDevicesQueryKey,
  getGetLivePositionsQueryKey,
  type ClientWithVehicles,
  type CreateClientInput,
  type Device,
  type LivePosition,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Car,
  Phone,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  UserCheck,
  UserX,
  X,
  CheckCircle2,
  MapPin,
  Navigation,
  Zap,
  Bell,
  ClockAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";

// ------- Vehicle Picker Dialog -------
function VehiclePicker({
  open,
  onClose,
  clientId,
  assignedDeviceIds,
}: {
  open: boolean;
  onClose: () => void;
  clientId: number;
  assignedDeviceIds: string[];
}) {
  const [search, setSearch] = useState("");
  const [didAddVehicles, setDidAddVehicles] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: devices = [], isLoading } = useListDevices({
    query: { queryKey: getListDevicesQueryKey(), staleTime: 30000 },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return devices.filter(
      (d: Device) =>
        !q ||
        d.plate.toLowerCase().includes(q) ||
        d.name.toLowerCase().includes(q) ||
        d.imei.includes(q)
    );
  }, [devices, search]);

  const notify = useNotifyClientAssignment();

  const addVehicle = useAddClientVehicle({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
        setDidAddVehicles(true);
        toast({ title: "Vehículo asignado" });
      },
      onError: () => toast({ title: "Error al asignar vehículo", variant: "destructive" }),
    },
  });

  const removeVehicle = useRemoveClientVehicle({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
        toast({ title: "Vehículo removido" });
      },
      onError: () => toast({ title: "Error al remover vehículo", variant: "destructive" }),
    },
  });

  const toggle = (device: Device) => {
    const isAssigned = assignedDeviceIds.includes(device.id);
    if (isAssigned) {
      removeVehicle.mutate({ id: clientId, deviceId: device.id });
    } else {
      addVehicle.mutate({
        id: clientId,
        data: { deviceId: device.id, deviceName: device.name, plate: device.plate },
      });
    }
  };

  const handleClose = () => {
    if (didAddVehicles && assignedDeviceIds.length > 0) {
      notify.mutate(
        { id: clientId },
        {
          onSuccess: (data) => {
            if (data.sent) {
              toast({ title: "✅ Notificación enviada", description: "El cliente recibió la lista de sus vehículos por Telegram." });
            }
            onClose();
          },
          onError: () => onClose(),
        }
      );
    } else {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Asignar Vehículos</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Selecciona los vehículos de la flota para este cliente.
          </p>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por placa, nombre o IMEI..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
          {isLoading && (
            <div className="text-center py-8 text-sm text-muted-foreground">Cargando vehículos...</div>
          )}
          {filtered.slice(0, 80).map((device: Device) => {
            const isAssigned = assignedDeviceIds.includes(device.id);
            const dotColor = getStatusColor(device.status);
            return (
              <button
                key={device.id}
                onClick={() => toggle(device)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors border",
                  isAssigned
                    ? "bg-primary/5 border-primary/30"
                    : "bg-transparent border-transparent hover:bg-muted/50"
                )}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: dotColor }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">
                      {device.plate || device.name}
                    </span>
                    {device.plate && device.name !== device.plate && (
                      <span className="text-xs text-muted-foreground truncate">
                        {device.name}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">IMEI: {device.imei}</div>
                </div>
                {isAssigned && (
                  <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                )}
              </button>
            );
          })}
          {filtered.length === 0 && !isLoading && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No se encontraron vehículos.
            </div>
          )}
        </div>

        <div className="border-t pt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>{assignedDeviceIds.length} vehículo(s) asignado(s)</span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={notify.isPending}
          >
            {notify.isPending ? "Enviando…" : "Listo"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------- Vehicle Row -------
function VehicleRow({
  vehicle,
  livePos,
  onRemove,
}: {
  vehicle: { deviceId: string; deviceName: string; plate: string };
  livePos?: LivePosition;
  onRemove: () => void;
}) {
  const statusColor = livePos ? getStatusColor(livePos.status) : "#64748b";
  const statusLabel = livePos ? getStatusLabel(livePos.status) : "Sin datos";
  const plate = vehicle.plate || livePos?.plate || vehicle.deviceName || vehicle.deviceId;
  const name = vehicle.deviceName || livePos?.name || vehicle.deviceId;
  const hasLocation = livePos?.lat && livePos?.lng;
  const mapsUrl = hasLocation ? `https://www.google.com/maps?q=${livePos!.lat},${livePos!.lng}` : null;

  return (
    <div className="rounded-lg border border-border bg-card/60 overflow-hidden group">
      {/* Color bar top */}
      <div className="h-0.5 w-full" style={{ background: statusColor }} />

      <div className="flex items-start gap-3 px-3 py-2.5">
        {/* Status dot */}
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
          style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}88` }}
        />

        {/* Main info */}
        <div className="flex-1 min-w-0 space-y-1">
          {/* Placa + nombre */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-foreground">{plate}</span>
            {name !== plate && (
              <span className="text-xs text-muted-foreground truncate">{name}</span>
            )}
          </div>

          {/* Estado + velocidad */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium" style={{ color: statusColor }}>
              {statusLabel}
              {livePos?.status === "moving" && livePos.speed ? ` · ${livePos.speed} km/h` : ""}
            </span>
            {livePos?.lastConnection && (
              <span className="text-xs text-muted-foreground">
                Última conexión: {new Date(livePos.lastConnection).toLocaleString("es-VE")}
              </span>
            )}
          </div>

          {/* Ubicación */}
          {hasLocation ? (
            <a
              href={mapsUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-400 transition-colors font-medium"
            >
              <MapPin className="w-3 h-3" />
              Ver ubicación en Google Maps
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
              <MapPin className="w-3 h-3" />
              Sin señal GPS
            </span>
          )}
        </div>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity p-1 flex-shrink-0"
          title="Quitar vehículo"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ------- Edit Client Dialog -------
function EditClientDialog({
  client,
  open,
  onClose,
}: {
  client: ClientWithVehicles;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(client.name);
  const [phone, setPhone] = useState(client.phone);
  const [telegramId, setTelegramId] = useState(client.telegramId ?? "");
  const { toast } = useToast();
  const qc = useQueryClient();

  const updateClient = useUpdateClient({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
        toast({ title: "Cliente actualizado" });
        onClose();
      },
      onError: () => toast({ title: "Error al actualizar", variant: "destructive" }),
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Cliente</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nombre</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Teléfono</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+584147XXXXXXX" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Telegram ID</label>
            <Input value={telegramId} onChange={(e) => setTelegramId(e.target.value)} placeholder="ID numérico de Telegram" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() =>
              updateClient.mutate({
                id: client.id,
                data: { name: name.trim(), phone: phone.trim(), telegramId: telegramId.trim() || undefined, isActive: client.isActive },
              })
            }
            disabled={!name.trim() || !phone.trim() || updateClient.isPending}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------- Create Client Dialog -------
function CreateClientDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const createClient = useCreateClient({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
        toast({ title: "Cliente creado" });
        setName(""); setPhone(""); setTelegramId("");
        onClose();
      },
      onError: () => toast({ title: "Error al crear cliente", variant: "destructive" }),
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo Cliente</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nombre <span className="text-destructive">*</span></label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre completo" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Teléfono <span className="text-destructive">*</span></label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+584147XXXXXXX" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Telegram ID <span className="text-muted-foreground text-xs">(opcional)</span></label>
            <Input value={telegramId} onChange={(e) => setTelegramId(e.target.value)} placeholder="ID numérico de Telegram" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => createClient.mutate({ data: { name: name.trim(), phone: phone.trim(), telegramId: telegramId.trim() || undefined } as CreateClientInput })}
            disabled={!name.trim() || !phone.trim() || createClient.isPending}
          >
            Crear Cliente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------- Client Row -------
function ClientRow({ client, liveMap }: { client: ClientWithVehicles; liveMap: Map<string, LivePosition> }) {
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const removeVehicle = useRemoveClientVehicle({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
        toast({ title: "Vehículo removido" });
      },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    },
  });

  const deleteClient = useDeleteClient({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
        toast({ title: `"${client.name}" eliminado` });
        setDeleteOpen(false);
      },
      onError: () => toast({ title: "Error al eliminar", variant: "destructive" }),
    },
  });

  const vehicleCount = client.vehicles?.length ?? 0;
  const assignedIds = (client.vehicles ?? []).map((v) => v.deviceId);

  return (
    <>
      <div className={cn("rounded-lg border bg-card shadow-sm transition-all", expanded ? "border-primary/30 shadow-primary/5" : "border-border")}>
        {/* Header row */}
        <div
          className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-muted/30 rounded-lg transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="text-muted-foreground">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>

          <div className="flex-shrink-0">
            {client.isActive
              ? <UserCheck className="w-4 h-4 text-green-600" />
              : <UserX className="w-4 h-4 text-muted-foreground" />}
          </div>

          <span className="font-semibold text-sm flex-1 truncate text-foreground">{client.name}</span>

          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
            <Phone className="w-3 h-3" />
            <span>{client.phone}</span>
          </div>

          {client.telegramId && (
            <div className="hidden md:flex items-center gap-1.5 text-xs flex-shrink-0">
              <MessageCircle className="w-3 h-3 text-blue-500" />
              <span className="text-blue-600 font-medium">
                {client.telegramUsername ? `@${client.telegramUsername}` : client.telegramId}
              </span>
            </div>
          )}

          <Badge
            variant="outline"
            className={cn("text-xs flex-shrink-0 gap-1", vehicleCount > 0 ? "border-primary/40 text-primary bg-primary/5" : "text-muted-foreground")}
          >
            <Car className="w-3 h-3" />
            {vehicleCount}
          </Badge>

          <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-primary hover:bg-primary/10" title="Editar" onClick={() => setEditOpen(true)}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive hover:bg-destructive/10" title="Eliminar" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Expanded vehicles */}
        {expanded && (
          <div className="px-4 pb-4 border-t border-border/60 pt-3 space-y-2">
            {vehicleCount === 0 && (
              <p className="text-sm text-muted-foreground italic">Sin vehículos asignados.</p>
            )}
            {(client.vehicles ?? []).map((v) => (
              <VehicleRow
                key={v.deviceId}
                vehicle={v}
                livePos={liveMap.get(v.deviceId)}
                onRemove={() => removeVehicle.mutate({ id: client.id, deviceId: v.deviceId })}
              />
            ))}
            <button
              className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors font-medium mt-1 px-1"
              onClick={() => setPickerOpen(true)}
            >
              <Plus className="w-3.5 h-3.5" />
              Gestionar vehículos de la flota
            </button>
          </div>
        )}
      </div>

      <EditClientDialog client={client} open={editOpen} onClose={() => setEditOpen(false)} />

      <VehiclePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        clientId={client.id}
        assignedDeviceIds={assignedIds}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Se desactivará <strong>{client.name}</strong> y se desvinculará su cuenta de Telegram. Sus datos y vehículos asignados se conservan. Si el cliente vuelve a iniciar el bot, podrá reactivarse automáticamente con su número de teléfono.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteClient.mutate({ id: client.id })} className="bg-destructive hover:bg-destructive/90">
              Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ------- Main Page -------
export function Clientes() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [pendingPicker, setPendingPicker] = useState<{ clientId: number } | null>(null);

  const { data: clients = [], isLoading } = useListClients({
    query: { refetchInterval: 5000, queryKey: getListClientsQueryKey() },
  });

  const { data: livePositions = [] } = useGetLivePositions({
    query: { refetchInterval: 10000, queryKey: getGetLivePositionsQueryKey(), staleTime: 8000 },
  });

  const liveMap = useMemo(() => {
    const m = new Map<string, LivePosition>();
    for (const p of livePositions) m.set(p.id, p);
    return m;
  }, [livePositions]);

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.telegramId ?? "").includes(q) ||
      (c.telegramUsername ?? "").toLowerCase().includes(q) ||
      (c.vehicles ?? []).some((v) =>
        v.deviceId.includes(q) || v.plate.toLowerCase().includes(q) || v.deviceName.toLowerCase().includes(q)
      );
    const matchStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && c.isActive) ||
      (statusFilter === "inactive" && !c.isActive);
    return matchSearch && matchStatus;
  });

  const totalVehicles = clients.reduce((s, c) => s + (c.vehicles?.length ?? 0), 0);
  const activeCount = clients.filter((c) => c.isActive).length;

  // Clientes sin vehículos — necesitan asignación (ordenados por más reciente)
  const pendingClients = clients
    .filter((c) => (c.vehicles?.length ?? 0) === 0 && c.isActive)
    .sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "hace un momento";
    if (m < 60) return `hace ${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `hace ${h}h`;
    return `hace ${Math.floor(h / 24)}d`;
  }

  return (
    <div className="space-y-5 flex flex-col h-[calc(100vh-100px)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Clientes</h1>
          <p className="text-sm text-muted-foreground">Gestión de clientes, Telegram y vehículos asignados.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" />
          Nuevo Cliente
        </Button>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-2 shrink-0">
        {[
          { label: "Total clientes", value: clients.length, cls: "text-foreground" },
          { label: "Activos", value: activeCount, cls: "text-green-700" },
          { label: "Inactivos", value: clients.length - activeCount, cls: "text-muted-foreground" },
          { label: "Vehículos asignados", value: totalVehicles, cls: "text-primary" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5 text-sm shadow-sm">
            <span className="text-muted-foreground">{s.label}:</span>
            <span className={cn("font-bold", s.cls)}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* ── Pendientes de asignar ── */}
      {pendingClients.length > 0 && (
        <div className="shrink-0 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              {pendingClients.length} cliente{pendingClients.length > 1 ? "s" : ""} sin vehículos asignados
            </span>
            <span className="ml-auto text-xs text-amber-500/60">Actualización cada 5s</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pendingClients.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-lg bg-card border border-border px-3 py-2.5 shadow-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground truncate">{c.name}</span>
                    {c.telegramId && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-500 bg-sky-500/10 border border-sky-500/20 rounded-full px-1.5 py-0.5">
                        <MessageCircle className="w-2.5 h-2.5" />
                        Telegram
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">{c.phone}</span>
                    <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                      <ClockAlert className="w-2.5 h-2.5" />
                      {timeAgo(c.registeredAt)}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="text-xs gap-1.5 shrink-0 h-7 px-2.5"
                  onClick={() => setPendingPicker({ clientId: c.id })}
                >
                  <Car className="w-3 h-3" />
                  Asignar
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por nombre, teléfono, placa..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                statusFilter === f
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {f === "all" ? "Todos" : f === "active" ? "Activos" : "Inactivos"}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Cargando clientes...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
            <UserX className="w-8 h-8 opacity-30" />
            {search ? "No se encontraron clientes con ese criterio." : "No hay clientes registrados."}
          </div>
        ) : (
          filtered.map((c) => <ClientRow key={c.id} client={c} liveMap={liveMap} />)
        )}
      </div>

      <CreateClientDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Picker de vehículos para clientes pendientes */}
      {pendingPicker && (
        <VehiclePicker
          open={true}
          onClose={() => {
            setPendingPicker(null);
            // Refresca la lista para que el cliente asignado salga de pendientes
          }}
          clientId={pendingPicker.clientId}
          assignedDeviceIds={
            clients.find((c) => c.id === pendingPicker.clientId)?.vehicles?.map((v) => v.deviceId) ?? []
          }
        />
      )}
    </div>
  );
}
