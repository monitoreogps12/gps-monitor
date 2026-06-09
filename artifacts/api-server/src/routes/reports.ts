import { Router, type IRouter } from "express";
import ExcelJS from "exceljs";
import { join } from "path";
import { existsSync } from "fs";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { fetchDevices, fetchLivePositions } from "../lib/gps-service";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseLastConnection(s: string): Date | null {
  if (!s || s === "N/A" || s.trim() === "") return null;
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    const m = s.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(AM|PM)/i);
    if (!m) return null;
    let h = parseInt(m[4]!);
    if (m[7]!.toUpperCase() === "PM" && h < 12) h += 12;
    if (m[7]!.toUpperCase() === "AM" && h === 12) h = 0;
    return new Date(parseInt(m[3]!), parseInt(m[2]!) - 1, parseInt(m[1]!), h, parseInt(m[5]!), parseInt(m[6]!));
  } catch { return null; }
}

function daysSince(d: Date | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

type Category = "activo" | "leve" | "atencion" | "grave" | "critico" | "sin_datos";

function getCategory(isDisconnected: boolean, days: number | null): Category {
  if (!isDisconnected) return "activo";
  if (days === null) return "sin_datos";
  if (days <= 6) return "leve";
  if (days <= 30) return "atencion";
  if (days <= 90) return "grave";
  return "critico";
}

async function buildReportData() {
  const [devices, livePositions, clients, vehicles] = await Promise.all([
    fetchDevices(),
    fetchLivePositions(),
    db.select().from(clientsTable),
    db.select().from(clientVehiclesTable),
  ]);

  const liveById = new Map(livePositions.map((p) => [p.id, p]));
  const vehicleByDeviceId = new Map(vehicles.map((v) => [v.deviceId, v]));
  const clientById = new Map(clients.map((c) => [c.id, c]));

  return devices.map((device) => {
    const live = liveById.get(device.id);
    const dbVehicle = vehicleByDeviceId.get(device.id);
    const client = dbVehicle ? clientById.get(dbVehicle.clientId) : null;
    const lastConnectionStr = live?.lastConnection || device.lastConnection || "";
    const lastDate = parseLastConnection(lastConnectionStr);
    const days = daysSince(lastDate);
    const isDisconnected = device.status === "disconnected_red" || device.status === "disconnected_blue";

    return {
      deviceId: device.id,
      name: live?.name || device.name,
      plate: live?.plate || device.plate || dbVehicle?.plate || "",
      imei: device.imei,
      gpsStatus: device.status,
      lastConnection: lastConnectionStr,
      daysSinceContact: days,
      category: getCategory(isDisconnected, days) as Category,
      clientName: client?.name ?? null,
      clientId: client?.id ?? null,
      clientPhone: client?.phone ?? null,
      lat: live?.lat ?? null,
      lng: live?.lng ?? null,
      speed: live?.speed ?? null,
    };
  });
}

router.get("/data", async (req, res): Promise<void> => {
  try {
    const data = await buildReportData();
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to build report data");
    res.status(500).json({ error: "Failed to build report data" });
  }
});

const CATEGORY_LABELS: Record<Category, string> = {
  critico: "CRÍTICO (>90 días)",
  grave: "GRAVE (31-90 días)",
  atencion: "ATENCIÓN (7-30 días)",
  leve: "LEVE (1-6 días)",
  activo: "ACTIVO",
  sin_datos: "SIN DATOS",
};

const CATEGORY_COLORS: Record<Category, string> = {
  critico: "FFC0392B",
  grave:   "FFD35400",
  atencion:"FFF39C12",
  leve:    "FF2980B9",
  activo:  "FF27AE60",
  sin_datos:"FF7F8C8D",
};

const CATEGORY_ROW_COLORS: Record<Category, string> = {
  critico: "FFFCE4E4",
  grave:   "FFFEF0E6",
  atencion:"FFFFF8E1",
  leve:    "FFE8F4FD",
  activo:  "FFE9F7EF",
  sin_datos:"FFF2F3F4",
};

const GPS_STATUS_LABELS: Record<string, string> = {
  moving: "En Movimiento",
  ack: "ACK / Encendido",
  engine_idle: "Motor en Ralentí",
  disconnected_red: "Sin Señal",
  disconnected_blue: "Desconectado",
};

const OP_STATUS_LABELS: Record<string, string> = {
  servicio:    "✅ En Servicio",
  taller:      "🔧 En Taller",
  revision:    "⚠️ Necesita Revisión",
  baja:        "❌ Fuera de Servicio",
  desconocido: "❓ Desconocido",
};

interface StatusEntry { status: string; notes: string; updatedAt: string; }
type StatusData = Record<string, StatusEntry>;

function styleHeader(ws: ExcelJS.Worksheet, row: ExcelJS.Row, bgColor: string) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF000000" } },
      bottom: { style: "thin", color: { argb: "FF000000" } },
      left: { style: "thin", color: { argb: "FF000000" } },
      right: { style: "thin", color: { argb: "FF000000" } },
    };
  });
  row.height = 28;
}

function styleDataRow(row: ExcelJS.Row, bgColor: string) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "hair", color: { argb: "FFCCCCCC" } },
      bottom: { style: "hair", color: { argb: "FFCCCCCC" } },
      left: { style: "thin", color: { argb: "FFCCCCCC" } },
      right: { style: "thin", color: { argb: "FFCCCCCC" } },
    };
  });
  row.height = 20;
}

function addDetailSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  devices: ReturnType<typeof buildReportData> extends Promise<infer T> ? T : never,
  category: Category,
  statusData: StatusData
) {
  const ws = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 3 }],
    properties: { tabColor: { argb: CATEGORY_COLORS[category] } },
  });

  ws.columns = [
    { key: "num",       width: 5  },
    { key: "plate",     width: 14 },
    { key: "name",      width: 30 },
    { key: "client",    width: 22 },
    { key: "phone",     width: 16 },
    { key: "imei",      width: 16 },
    { key: "lastConn",  width: 22 },
    { key: "days",      width: 14 },
    { key: "gpsStatus", width: 18 },
    { key: "opStatus",  width: 20 },
    { key: "notes",     width: 30 },
  ];

  // Title row
  ws.mergeCells("A1:K1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `GPS SISTEMA C.A. — ${CATEGORY_LABELS[category]}`;
  titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CATEGORY_COLORS[category] } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 35;

  // Date row
  ws.mergeCells("A2:K2");
  const dateCell = ws.getCell("A2");
  dateCell.value = `Generado: ${new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })} | Total: ${devices.length} unidad(es)`;
  dateCell.font = { italic: true, size: 10, color: { argb: "FF666666" } };
  dateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F9FA" } };
  dateCell.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(2).height = 18;

  // Header row
  const headerRow = ws.addRow(["#", "Placa", "Vehículo / Dispositivo", "Cliente", "Teléfono", "IMEI", "Último Contacto", "Días Sin Señal", "Estado GPS", "Estado Operacional", "Observaciones"]);
  styleHeader(ws, headerRow, CATEGORY_COLORS[category]);

  // Data rows
  devices.forEach((d, i) => {
    const st = statusData[d.deviceId];
    const row = ws.addRow([
      i + 1,
      d.plate || "—",
      d.name,
      d.clientName ?? "Sin asignar",
      d.clientPhone ?? "—",
      d.imei || "—",
      d.lastConnection || "—",
      d.daysSinceContact !== null ? d.daysSinceContact : "—",
      GPS_STATUS_LABELS[d.gpsStatus] ?? d.gpsStatus,
      st ? OP_STATUS_LABELS[st.status] ?? "❓ Desconocido" : "❓ Desconocido",
      st?.notes ?? "",
    ]);

    const rowBg = CATEGORY_ROW_COLORS[d.category] ?? "FFFFFFFF";
    styleDataRow(row, i % 2 === 0 ? rowBg : "FFFFFFFF");

    // Highlight days cell
    const daysCell = row.getCell(8);
    if (typeof daysCell.value === "number") {
      daysCell.font = { bold: true, color: { argb: CATEGORY_COLORS[d.category] } };
    }
  });

  ws.autoFilter = { from: "A3", to: "K3" };
}

router.post("/excel", async (req, res): Promise<void> => {
  try {
    const statusData: StatusData = (req.body as { statusData?: StatusData }).statusData ?? {};
    const allData = await buildReportData();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "GPS SISTEMA C.A.";
    workbook.created = new Date();
    workbook.modified = new Date();

    // ── Logo ──────────────────────────────────────────────────────────────────
    const logoPaths = [
      join(process.cwd(), "artifacts/gps-admin/dist/public/logo-gps.png"),
      join(process.cwd(), "artifacts/gps-admin/public/logo-gps.png"),
    ];
    const logoPath = logoPaths.find(existsSync) ?? null;
    let logoImageId: number | null = null;
    if (logoPath) {
      logoImageId = workbook.addImage({ filename: logoPath, extension: "png" });
    }

    // ── Summary Sheet ─────────────────────────────────────────────────────────
    const ws0 = workbook.addWorksheet("Resumen Ejecutivo", {
      properties: { tabColor: { argb: "FF1A252F" } },
    });

    ws0.columns = [
      { width: 5 }, { width: 28 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
    ];

    // Logo area (rows 1-5)
    ws0.mergeCells("B1:F5");
    const logoTitleCell = ws0.getCell("B1");
    logoTitleCell.value = "GPS SISTEMA C.A.";
    logoTitleCell.font = { bold: true, size: 28, color: { argb: "FF1A252F" } };
    logoTitleCell.alignment = { vertical: "middle", horizontal: "right" };

    if (logoImageId !== null) {
      ws0.addImage(logoImageId, { tl: { col: 0, row: 0 }, ext: { width: 110, height: 110 } });
    }

    for (let r = 1; r <= 5; r++) {
      ws0.getRow(r).height = 22;
      ws0.getRow(r).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
    }

    // Report title
    ws0.mergeCells("A6:F6");
    const mainTitle = ws0.getCell("A6");
    mainTitle.value = "REPORTE DE FALLAS Y ESTADO DE FLOTA";
    mainTitle.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    mainTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A252F" } };
    mainTitle.alignment = { vertical: "middle", horizontal: "center" };
    ws0.getRow(6).height = 38;

    ws0.mergeCells("A7:F7");
    const dateTitle = ws0.getCell("A7");
    dateTitle.value = `Fecha de generación: ${new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })}`;
    dateTitle.font = { italic: true, size: 11, color: { argb: "FF555555" } };
    dateTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F3F4" } };
    dateTitle.alignment = { vertical: "middle", horizontal: "center" };
    ws0.getRow(7).height = 22;

    ws0.addRow([]);

    // Summary table header
    const categories: Category[] = ["critico", "grave", "atencion", "leve", "activo", "sin_datos"];
    const summaryHeader = ws0.addRow(["", "CATEGORÍA", "CANTIDAD", "% DEL TOTAL", "ESTADO", "ACCIÓN RECOMENDADA"]);
    styleHeader(ws0, summaryHeader, "FF2C3E50");

    const totalDevices = allData.length;
    const actions: Record<Category, string> = {
      critico: "Inspección inmediata — posible equipo perdido",
      grave: "Revisión urgente esta semana",
      atencion: "Programar revisión próxima semana",
      leve: "Monitorear — puede ser falla temporal",
      activo: "Operativo — sin acción requerida",
      sin_datos: "Verificar instalación del dispositivo",
    };

    categories.forEach((cat) => {
      const count = allData.filter((d) => d.category === cat).length;
      const pct = totalDevices > 0 ? ((count / totalDevices) * 100).toFixed(1) : "0.0";
      const row = ws0.addRow(["", CATEGORY_LABELS[cat], count, `${pct}%`, "", actions[cat]]);
      row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CATEGORY_ROW_COLORS[cat] } };
      row.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CATEGORY_ROW_COLORS[cat] } };
      row.getCell(3).font = { bold: true, color: { argb: CATEGORY_COLORS[cat] }, size: 12 };
      row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CATEGORY_ROW_COLORS[cat] } };
      row.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CATEGORY_ROW_COLORS[cat] } };
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFCCCCCC" } },
          bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
          left: { style: "thin", color: { argb: "FFCCCCCC" } },
          right: { style: "thin", color: { argb: "FFCCCCCC" } },
        };
      });
      row.height = 22;
    });

    // Total row
    ws0.addRow([]);
    const totalRow = ws0.addRow(["", "TOTAL DE DISPOSITIVOS", totalDevices, "100%", "", ""]);
    totalRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { bold: true, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2C3E50" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        top: { style: "medium", color: { argb: "FF000000" } },
        bottom: { style: "medium", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
      };
    });
    totalRow.height = 24;

    // ── Detail Sheets ─────────────────────────────────────────────────────────
    const sheetDefs: Array<{ name: string; cat: Category; filter: (d: typeof allData[0]) => boolean }> = [
      { name: "🔴 Críticos",  cat: "critico",  filter: (d) => d.category === "critico"  },
      { name: "🟠 Graves",    cat: "grave",    filter: (d) => d.category === "grave"    },
      { name: "🟡 Atención",  cat: "atencion", filter: (d) => d.category === "atencion" },
      { name: "🔵 Leve",      cat: "leve",     filter: (d) => d.category === "leve"     },
      { name: "⚪ Sin Datos",  cat: "sin_datos",filter: (d) => d.category === "sin_datos"},
      { name: "✅ Activos",   cat: "activo",   filter: (d) => d.category === "activo"   },
    ];

    for (const { name, cat, filter } of sheetDefs) {
      const subset = allData.filter(filter).sort((a, b) => (b.daysSinceContact ?? 0) - (a.daysSinceContact ?? 0));
      addDetailSheet(workbook, name, subset, cat, statusData);
    }

    // All disconnected sheet
    const allDisc = allData
      .filter((d) => d.category !== "activo")
      .sort((a, b) => (b.daysSinceContact ?? 0) - (a.daysSinceContact ?? 0));
    addDetailSheet(workbook, "📋 Todos Desconectados", allDisc, "sin_datos", statusData);

    // ── Stream response ───────────────────────────────────────────────────────
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Reporte_Fallas_GPS_${date}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Failed to generate Excel report");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate Excel" });
    }
  }
});

export default router;
