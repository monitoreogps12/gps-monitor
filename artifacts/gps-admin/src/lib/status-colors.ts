export const statusColors = {
  moving: "#22c55e",
  disconnected_blue: "#3b82f6",
  disconnected_red: "#ef4444",
  ack: "#eab308",
  engine_idle: "#f97316",
  unknown: "#6b7280"
} as const;

export type DeviceStatus = keyof typeof statusColors;

export function getStatusColor(status: string) {
  return statusColors[status as DeviceStatus] || statusColors.unknown;
}

export function getStatusLabel(status: string) {
  switch (status) {
    case "moving": return "En Movimiento";
    case "disconnected_blue": return "Desconectado";
    case "disconnected_red": return "Desconectado (Sin Señal)";
    case "ack": return "ACK";
    case "engine_idle": return "Ralentí de Motor";
    default: return "Desconocido";
  }
}
