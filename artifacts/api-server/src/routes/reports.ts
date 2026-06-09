import { Router, type IRouter } from "express";
import ExcelJS from "exceljs";
import { join } from "path";
import { existsSync } from "fs";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { fetchDevices, fetchLivePositions } from "../lib/gps-service";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Date parsing ────────────────────────────────────────────────────────────

function parseLastConnection(s: string): Date | null {
  if (!s || s === "N/A" || s.trim() === "") return null;
  try {
    // ISO / standard format first
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    // DD-MM-YYYY HH:MM:SS AM/PM (platform format)
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

// ─── Category logic ──────────────────────────────────────────────────────────
// A device is ACTIVO only if GPS platform reports active status AND the last
// real GPS timestamp is ≤ 1 day ago. Vehicles from 2019/2021 that the platform
// still shows as "moving" must be categorised by their actual days count.

type Category = "activo" | "leve" | "atencion" | "grave" | "critico" | "sin_datos";

const ACTIVE_GPS = new Set(["moving", "ack", "engine_idle"]);

function getCategory(gpsStatus: string, days: number | null): Category {
  const platformActive = ACTIVE_GPS.has(gpsStatus);

  if (days === null) {
    // No timestamp at all — trust platform status
    return platformActive ? "activo" : "sin_datos";
  }

  // Truly active: platform shows active AND last contact was ≤ 1 day ago
  if (platformActive && days <= 1) return "activo";

  // From here, device is effectively disconnected — categorise by days offline
  if (days <= 6)  return "leve";
  if (days <= 30) return "atencion";
  if (days <= 90) return "grave";
  return "critico";
}

// ─── Build report ─────────────────────────────────────────────────────────────

async function buildReportData() {
  const [devices, livePositions, clients, vehicles] = await Promise.all([
    fetchDevices(),
    fetchLivePositions(),
    db.select().from(clientsTable),
    db.select().from(clientVehiclesTable),
  ]);

  const liveById         = new Map(livePositions.map((p) => [p.id, p]));
  const vehicleByDevice  = new Map(vehicles.map((v) => [v.deviceId, v]));
  const clientById       = new Map(clients.map((c) => [c.id, c]));

  return devices.map((device) => {
    const live      = liveById.get(device.id);
    const dbVehicle = vehicleByDevice.get(device.id);
    const client    = dbVehicle ? clientById.get(dbVehicle.clientId) : null;

    // Prefer live GPS timestamp; fall back to device.lastConnection only as last resort
    const lastConnectionStr = live?.lastConnection || device.lastConnection || "";
    const lastDate          = parseLastConnection(lastConnectionStr);
    const days              = daysSince(lastDate);
    const category          = getCategory(device.status, days);

    return {
      deviceId:        device.id,
      name:            live?.name || device.name,
      plate:           live?.plate || device.plate || dbVehicle?.plate || "",
      imei:            device.imei,
      gpsStatus:       device.status,
      lastConnection:  lastConnectionStr,
      daysSinceContact: days,
      category,
      clientName:      client?.name ?? null,
      clientId:        client?.id ?? null,
      clientPhone:     client?.phone ?? null,
      lat:             live?.lat ?? null,
      lng:             live?.lng ?? null,
      speed:           live?.speed ?? null,
    };
  });
}

// ─── GET /api/reports/data ───────────────────────────────────────────────────

router.get("/data", async (req, res): Promise<void> => {
  try {
    const data = await buildReportData();
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to build report data");
    res.status(500).json({ error: "Failed to build report data" });
  }
});

// ─── Excel helpers ────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<Category, string> = {
  critico:   "CRÍTICO  (>90 días)",
  grave:     "GRAVE    (31–90 días)",
  atencion:  "ATENCIÓN (7–30 días)",
  leve:      "LEVE     (1–6 días)",
  activo:    "ACTIVO",
  sin_datos: "SIN DATOS",
};

const CAT_FG: Record<Category, string> = {
  critico:   "FFC0392B",
  grave:     "FFD35400",
  atencion:  "FFF39C12",
  leve:      "FF2980B9",
  activo:    "FF27AE60",
  sin_datos: "FF7F8C8D",
};

const CAT_ROW: Record<Category, string> = {
  critico:   "FFFCE4E4",
  grave:     "FFFEF0E6",
  atencion:  "FFFFF8E1",
  leve:      "FFE8F4FD",
  activo:    "FFE9F7EF",
  sin_datos: "FFF2F3F4",
};

const GPS_LABELS: Record<string, string> = {
  moving:            "En Movimiento",
  ack:               "ACK / Encendido",
  engine_idle:       "Motor en Ralentí",
  disconnected_red:  "Sin Señal",
  disconnected_blue: "Desconectado",
};

const OP_LABELS: Record<string, string> = {
  servicio:    "En Servicio",
  taller:      "En Taller",
  revision:    "Necesita Revisión",
  baja:        "Fuera de Servicio",
  desconocido: "Desconocido",
};

interface StatusEntry { status: string; notes: string; }
type StatusData = Record<string, StatusEntry>;

type ReportRow = Awaited<ReturnType<typeof buildReportData>>[number];

function applyHeaderStyle(row: ExcelJS.Row, argb: string) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb } };
    cell.font   = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top:    { style: "thin",  color: { argb: "FF000000" } },
      bottom: { style: "thin",  color: { argb: "FF000000" } },
      left:   { style: "thin",  color: { argb: "FF000000" } },
      right:  { style: "thin",  color: { argb: "FF000000" } },
    };
  });
  row.height = 28;
}

function applyDataRowStyle(row: ExcelJS.Row, argb: string) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb } };
    cell.alignment = { vertical: "middle", wrapText: false };
    cell.border    = {
      top:    { style: "hair", color: { argb: "FFCCCCCC" } },
      bottom: { style: "hair", color: { argb: "FFCCCCCC" } },
      left:   { style: "thin", color: { argb: "FFCCCCCC" } },
      right:  { style: "thin", color: { argb: "FFCCCCCC" } },
    };
  });
  row.height = 20;
}

const COLUMNS = [
  { key: "num",       header: "#",                    width: 5  },
  { key: "plate",     header: "Placa",                width: 13 },
  { key: "name",      header: "Vehículo / Dispositivo", width: 32 },
  { key: "client",    header: "Cliente",              width: 22 },
  { key: "phone",     header: "Teléfono",             width: 14 },
  { key: "imei",      header: "IMEI",                 width: 16 },
  { key: "lastConn",  header: "Último Contacto",      width: 22 },
  { key: "days",      header: "Días Sin Señal",       width: 14 },
  { key: "gpsStatus", header: "Estado GPS",           width: 18 },
  { key: "opStatus",  header: "Estado Operacional",   width: 20 },
  { key: "notes",     header: "Observaciones",        width: 30 },
];

function addDetailSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: ReportRow[],
  cat: Category,
  statusData: StatusData,
) {
  const ws = wb.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 3 }],
    properties: { tabColor: { argb: CAT_FG[cat] } },
  });

  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

  // Title
  ws.mergeCells(`A1:K1`);
  const t = ws.getCell("A1");
  t.value     = `GPS SISTEMA C.A. — ${CATEGORY_LABELS[cat]}`;
  t.font      = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: CAT_FG[cat] } };
  t.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 35;

  // Sub-title
  ws.mergeCells("A2:K2");
  const sub = ws.getCell("A2");
  sub.value     = `Generado: ${new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })}   |   Total: ${rows.length} unidad(es)`;
  sub.font      = { italic: true, size: 10, color: { argb: "FF555555" } };
  sub.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F9FA" } };
  sub.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(2).height = 18;

  // Header row
  const hRow = ws.addRow(COLUMNS.map((c) => c.header));
  applyHeaderStyle(hRow, CAT_FG[cat]);

  // Data rows
  rows.forEach((d, i) => {
    const st  = statusData[d.deviceId];
    const row = ws.addRow([
      i + 1,
      d.plate           || "—",
      d.name,
      d.clientName      ?? "Sin asignar",
      d.clientPhone     ?? "—",
      d.imei            || "—",
      d.lastConnection  || "—",
      d.daysSinceContact !== null ? d.daysSinceContact : "—",
      GPS_LABELS[d.gpsStatus] ?? d.gpsStatus,
      st ? (OP_LABELS[st.status] ?? "Desconocido") : "Desconocido",
      st?.notes ?? "",
    ]);

    const bg = i % 2 === 0 ? CAT_ROW[d.category] : "FFFFFFFF";
    applyDataRowStyle(row, bg);

    // Highlight days count
    const daysCell = row.getCell(8);
    if (typeof daysCell.value === "number") {
      daysCell.font = { bold: true, color: { argb: CAT_FG[d.category] } };
    }
  });

  ws.autoFilter = { from: "A3", to: "K3" };
}

// ─── POST /api/reports/excel ──────────────────────────────────────────────────

router.post("/excel", async (req, res): Promise<void> => {
  try {
    const statusData: StatusData = (req.body as { statusData?: StatusData }).statusData ?? {};
    const all = await buildReportData();

    const wb = new ExcelJS.Workbook();
    wb.creator  = "GPS SISTEMA C.A.";
    wb.created  = new Date();
    wb.modified = new Date();

    // Logo
    const logoPaths = [
      join(process.cwd(), "artifacts/gps-admin/dist/public/logo-gps.png"),
      join(process.cwd(), "artifacts/gps-admin/public/logo-gps.png"),
    ];
    const logoPath = logoPaths.find(existsSync) ?? null;
    let logoId: number | null = null;
    if (logoPath) {
      logoId = wb.addImage({ filename: logoPath, extension: "png" });
    }

    // ── Sheet 1: Resumen Ejecutivo ────────────────────────────────────────────
    const ws0 = wb.addWorksheet("📊 Resumen Ejecutivo", {
      properties: { tabColor: { argb: "FF1A252F" } },
    });

    ws0.columns = [
      { width: 5 }, { width: 30 }, { width: 15 }, { width: 12 }, { width: 40 },
    ];

    // Logo area
    for (let r = 1; r <= 6; r++) {
      ws0.getRow(r).height = 20;
      ws0.mergeCells(`A${r}:E${r}`);
      ws0.getRow(r).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
    }
    if (logoId !== null) {
      ws0.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 120, height: 120 } });
    }

    // Company name (offset from logo)
    ws0.getCell("C2").value = "GPS SISTEMA C.A.";
    ws0.getCell("C2").font  = { bold: true, size: 22, color: { argb: "FF1A252F" } };

    ws0.getCell("C3").value = "Sistema de Monitoreo Vehicular";
    ws0.getCell("C3").font  = { italic: true, size: 12, color: { argb: "FF555555" } };

    // Title bar
    ws0.mergeCells("A7:E7");
    const titleCell = ws0.getCell("A7");
    titleCell.value     = "REPORTE DE FALLAS Y ESTADO DE FLOTA";
    titleCell.font      = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    titleCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A252F" } };
    titleCell.alignment = { vertical: "middle", horizontal: "center" };
    ws0.getRow(7).height = 38;

    ws0.mergeCells("A8:E8");
    const dateCell = ws0.getCell("A8");
    dateCell.value     = `Fecha de generación: ${new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })}`;
    dateCell.font      = { italic: true, size: 11, color: { argb: "FF444444" } };
    dateCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F3F4" } };
    dateCell.alignment = { vertical: "middle", horizontal: "center" };
    ws0.getRow(8).height = 22;

    ws0.addRow([]);

    // Summary table
    const summaryHeader = ws0.addRow(["", "CATEGORÍA", "UNIDADES", "% TOTAL", "ACCIÓN RECOMENDADA"]);
    applyHeaderStyle(summaryHeader, "FF2C3E50");

    const ACTIONS: Record<Category, string> = {
      critico:   "Inspección inmediata — posible equipo perdido o averiado",
      grave:     "Revisión urgente esta semana",
      atencion:  "Programar revisión la próxima semana",
      leve:      "Monitorear — puede ser falla temporal de señal",
      activo:    "Operativo — sin acción requerida",
      sin_datos: "Verificar instalación del dispositivo GPS",
    };

    const total = all.length;
    for (const cat of ["critico", "grave", "atencion", "leve", "sin_datos", "activo"] as Category[]) {
      const count = all.filter((d) => d.category === cat).length;
      const pct   = total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "0.0%";
      const row   = ws0.addRow(["", CATEGORY_LABELS[cat], count, pct, ACTIONS[cat]]);

      const bg = CAT_ROW[cat];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border    = {
          top: { style: "thin", color: { argb: "FFCCCCCC" } }, bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
          left: { style: "thin", color: { argb: "FFCCCCCC" } }, right: { style: "thin", color: { argb: "FFCCCCCC" } },
        };
      });
      row.getCell(3).font = { bold: true, color: { argb: CAT_FG[cat] }, size: 12 };
      row.height = 22;
    }

    // Total row
    ws0.addRow([]);
    const totalRow = ws0.addRow(["", "TOTAL DE DISPOSITIVOS", total, "100%", ""]);
    applyHeaderStyle(totalRow, "FF2C3E50");

    // ── Detail sheets ─────────────────────────────────────────────────────────
    const sheets: Array<{ name: string; cat: Category }> = [
      { name: "🔴 Críticos",   cat: "critico"  },
      { name: "🟠 Graves",     cat: "grave"    },
      { name: "🟡 Atención",   cat: "atencion" },
      { name: "🔵 Leve",       cat: "leve"     },
      { name: "⚪ Sin Datos",  cat: "sin_datos" },
      { name: "✅ Activos",    cat: "activo"   },
    ];

    for (const { name, cat } of sheets) {
      const subset = all
        .filter((d) => d.category === cat)
        .sort((a, b) => (b.daysSinceContact ?? 0) - (a.daysSinceContact ?? 0));
      addDetailSheet(wb, name, subset, cat, statusData);
    }

    // All disconnected
    const allDisc = all
      .filter((d) => d.category !== "activo")
      .sort((a, b) => (b.daysSinceContact ?? 0) - (a.daysSinceContact ?? 0));
    addDetailSheet(wb, "📋 Todos Desconectados", allDisc, "critico", statusData);

    // Stream
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Reporte_Fallas_GPS_${date}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error({ err }, "Excel generation failed");
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate Excel" });
  }
});

export default router;
