import { useState } from "react";
import {
  useListClients,
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
  useAddClientVehicle,
  useRemoveClientVehicle,
  getListClientsQueryKey,
  type ClientWithVehicles,
  type CreateClientInput,
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
} from "lucide-react";
import { cn } from "@/lib/utils";

function VehicleRow({
  clientId,
  vehicle,
  onRemove,
}: {
  clientId: number;
  vehicle: { deviceId: string; deviceName: string; plate: string };
  onRemove: (deviceId: string) => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 rounded bg-muted/30 group">
      <div className="flex items-center gap-3 text-sm">
        <Car className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium text-foreground">
          {vehicle.plate || vehicle.deviceName || vehicle.deviceId}
        </span>
        <span className="text-muted-foreground text-xs">ID: {vehicle.deviceId}</span>
        {vehicle.deviceName && vehicle.deviceName !== vehicle.plate && (
          <span className="text-muted-foreground text-xs truncate max-w-[120px]">
            {vehicle.deviceName}
          </span>
        )}
      </div>
      <button
        onClick={() => onRemove(vehicle.deviceId)}
        className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity p-0.5"
        title="Eliminar vehículo"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function AddVehicleInput({
  clientId,
  onAdded,
}: {
  clientId: number;
  onAdded: () => void;
}) {
  const [deviceId, setDeviceId] = useState("");
  const [plate, setPlate] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const addVehicle = useAddClientVehicle({
    mutation: {
      onSuccess: () => {
        setDeviceId("");
        setPlate("");
        qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
        onAdded();
        toast({ title: "Vehículo agregado" });
      },
      onError: () => toast({ title: "Error al agregar vehículo", variant: "destructive" }),
    },
  });

  const handleAdd = () => {
    if (!deviceId.trim()) return;
    addVehicle.mutate({
      id: clientId,
      data: { deviceId: deviceId.trim(), deviceName: "", plate: plate.trim() },
    });
  };

  return (
    <div className="flex gap-2 mt-2">
      <Input
        placeholder="ID Dispositivo (ej: 1505)"
        value={deviceId}
        onChange={(e) => setDeviceId(e.target.value)}
        className="h-8 text-sm bg-card border-border"
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
      />
      <Input
        placeholder="Placa (ej: ABC123)"
        value={plate}
        onChange={(e) => setPlate(e.target.value)}
        className="h-8 text-sm bg-card border-border w-36"
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
      />
      <Button
        size="sm"
        className="h-8 px-3"
        onClick={handleAdd}
        disabled={!deviceId.trim() || addVehicle.isPending}
      >
        <Plus className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

function ClientRow({ client }: { client: ClientWithVehicles }) {
  const [expanded, setExpanded] = useState(false);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const removeVehicle = useRemoveClientVehicle({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
        toast({ title: "Vehículo eliminado" });
      },
      onError: () => toast({ title: "Error al eliminar vehículo", variant: "destructive" }),
    },
  });

  const deleteClient = useDeleteClient({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
        toast({ title: `Cliente "${client.name}" eliminado` });
        setDeleteOpen(false);
      },
      onError: () => toast({ title: "Error al eliminar cliente", variant: "destructive" }),
    },
  });

  const vehicleCount = client.vehicles?.length ?? 0;

  return (
    <>
      <div
        className={cn(
          "rounded-lg border border-border bg-card transition-all",
          expanded && "border-primary/30"
        )}
      >
        {/* Client header row */}
        <div
          className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
          onClick={() => setExpanded((v) => !v)}
        >
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>

          {/* Status */}
          <div className="shrink-0">
            {client.isActive ? (
              <UserCheck className="w-4 h-4 text-green-500" />
            ) : (
              <UserX className="w-4 h-4 text-muted-foreground" />
            )}
          </div>

          {/* Name */}
          <span className="font-semibold text-sm flex-1 truncate">{client.name}</span>

          {/* Phone */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Phone className="w-3 h-3" />
            <span>{client.phone}</span>
          </div>

          {/* Telegram */}
          {client.telegramId && (
            <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
              <MessageCircle className="w-3 h-3 text-blue-400" />
              <span className="text-blue-400/80">{client.telegramUsername ? `@${client.telegramUsername}` : client.telegramId}</span>
            </div>
          )}

          {/* Vehicle count */}
          <Badge
            variant="outline"
            className={cn(
              "text-xs shrink-0 gap-1",
              vehicleCount > 0
                ? "border-primary/40 text-primary"
                : "text-muted-foreground"
            )}
          >
            <Car className="w-3 h-3" />
            {vehicleCount}
          </Badge>

          {/* Actions */}
          <div
            className="flex items-center gap-1 ml-1 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:text-primary"
              title="Editar cliente"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:text-destructive"
              title="Eliminar cliente"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Expanded vehicles section */}
        {expanded && (
          <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-2">
            {vehicleCount === 0 && !addingVehicle && (
              <p className="text-sm text-muted-foreground italic">Sin vehículos asignados.</p>
            )}
            {(client.vehicles ?? []).map((v) => (
              <VehicleRow
                key={v.deviceId}
                clientId={client.id}
                vehicle={v}
                onRemove={(deviceId) =>
                  removeVehicle.mutate({ id: client.id, deviceId })
                }
              />
            ))}
            {addingVehicle ? (
              <AddVehicleInput
                clientId={client.id}
                onAdded={() => setAddingVehicle(false)}
              />
            ) : (
              <button
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mt-1"
                onClick={() => setAddingVehicle(true)}
              >
                <Plus className="w-3.5 h-3.5" />
                Agregar vehículo
              </button>
            )}
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <EditClientDialog
        client={client}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará a <strong>{client.name}</strong> y todos sus vehículos asignados.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteClient.mutate({ id: client.id })}
              className="bg-destructive hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

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

  const handleSave = () => {
    updateClient.mutate({
      id: client.id,
      data: {
        name: name.trim(),
        phone: phone.trim(),
        telegramId: telegramId.trim() || undefined,
        isActive: client.isActive,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Cliente</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nombre</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-card border-border"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Teléfono</label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+584147XXXXXXX"
              className="bg-card border-border"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Telegram ID</label>
            <Input
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
              placeholder="ID numérico de Telegram"
              className="bg-card border-border"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || !phone.trim() || updateClient.isPending}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateClientDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const createClient = useCreateClient({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
        toast({ title: "Cliente creado exitosamente" });
        setName("");
        setPhone("");
        setTelegramId("");
        onClose();
      },
      onError: () => toast({ title: "Error al crear cliente", variant: "destructive" }),
    },
  });

  const handleCreate = () => {
    const body: CreateClientInput = {
      name: name.trim(),
      phone: phone.trim(),
      telegramId: telegramId.trim() || undefined,
    };
    createClient.mutate({ data: body });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo Cliente</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Nombre <span className="text-destructive">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre completo"
              className="bg-card border-border"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Teléfono <span className="text-destructive">*</span>
            </label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+584147XXXXXXX"
              className="bg-card border-border"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Telegram ID</label>
            <Input
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
              placeholder="ID numérico de Telegram (opcional)"
              className="bg-card border-border"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || !phone.trim() || createClient.isPending}
          >
            Crear Cliente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Clientes() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const { data: clients = [], isLoading } = useListClients({
    query: { refetchInterval: 30000, queryKey: getListClientsQueryKey() },
  });

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.telegramId ?? "").includes(q) ||
      (c.telegramUsername ?? "").toLowerCase().includes(q) ||
      (c.vehicles ?? []).some(
        (v) =>
          v.deviceId.includes(q) ||
          v.plate.toLowerCase().includes(q) ||
          v.deviceName.toLowerCase().includes(q)
      );
    const matchStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && c.isActive) ||
      (statusFilter === "inactive" && !c.isActive);
    return matchSearch && matchStatus;
  });

  const totalVehicles = clients.reduce((sum, c) => sum + (c.vehicles?.length ?? 0), 0);
  const activeCount = clients.filter((c) => c.isActive).length;

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-100px)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Gestión de clientes, Telegram y vehículos asignados.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" />
          Nuevo Cliente
        </Button>
      </div>

      {/* Stats strip */}
      <div className="flex flex-wrap gap-3 shrink-0">
        {[
          { label: "Total clientes", value: clients.length, color: "text-foreground" },
          { label: "Activos", value: activeCount, color: "text-green-500" },
          { label: "Inactivos", value: clients.length - activeCount, color: "text-muted-foreground" },
          { label: "Vehículos asignados", value: totalVehicles, color: "text-primary" },
        ].map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-2 bg-card border border-border rounded-md px-3 py-1.5 text-sm"
          >
            <span className="text-muted-foreground">{s.label}:</span>
            <span className={cn("font-semibold", s.color)}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, teléfono, placa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card border-border"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                statusFilter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "all" ? "Todos" : f === "active" ? "Activos" : "Inactivos"}
            </button>
          ))}
        </div>
      </div>

      {/* Client list */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            Cargando clientes...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
            <UserX className="w-8 h-8 opacity-40" />
            {search ? "No se encontraron clientes con ese criterio." : "No hay clientes registrados."}
          </div>
        ) : (
          filtered.map((c) => <ClientRow key={c.id} client={c} />)
        )}
      </div>

      <CreateClientDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
