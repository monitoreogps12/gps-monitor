import { useState, useMemo } from "react";
import {
  useGetOfflineReport,
  getGetOfflineReportQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileSpreadsheet,
  RefreshCw,
  AlertTriangle,
  Phone,
  Coffee,
  WifiOff,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Formats the GPS platform time string for display.
 * Handles: "DD-MM-YYYY HH:MM:SS AM/PM", "YYYY-MM-DD", "0000-00-00"
 */
function formatLastSeen(raw: string | null | undefined): string {
  if (!raw || raw === "0000-00-00" || raw === "0000-00-00 00:00:00") return "Sin datos";
  // DD-MM-YYYY HH:MM:SS AM → keep as-is (platform format, already readable)
  if (/^\d{2}-\d{2}-\d{4}/.test(raw)) return raw;
  // YYYY-MM-DD → localise
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${d}-${m}-${y}`;
  }
  return raw;
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Category = "urgente" | "contacto" | "descanso";

interface OfflineItem {
  id: string;
  name: string;
  plate: string;
  simNumber: string;
  model: string | null | undefined;
  lastConnection: string;
  daysOffline: number;
  category: Category;
  installationDate: string | null | undefined;
}

// ─── Category config ──────────────────────────────────────────────────────────
const CATEGORIES: Record<
  Category,
  {
    label: string;
    sublabel: string;
    icon: React.ElementType;
    headerBg: string;
    headerText: string;
    borderColor: string;
    badgeBg: string;
    badgeText: string;
    dotColor: string;
    rowAlt: string;
    daysColor: string;
  }
> = {
  urgente: {
    label: "Revisión Urgente",
    sublabel: "7 días o más sin conexión",
    icon: AlertTriangle,
    headerBg: "#FEF2F2",
    headerText: "#991B1B",
    borderColor: "#FECACA",
    badgeBg: "#FEE2E2",
    badgeText: "#991B1B",
    dotColor: "#DC2626",
    rowAlt: "#FFF5F5",
    daysColor: "#DC2626",
  },
  contacto: {
    label: "Contacto con Cliente",
    sublabel: "3 a 7 días sin conexión",
    icon: Phone,
    headerBg: "#FFFBEB",
    headerText: "#92400E",
    borderColor: "#FDE68A",
    badgeBg: "#FEF3C7",
    badgeText: "#92400E",
    dotColor: "#D97706",
    rowAlt: "#FFFDF5",
    daysColor: "#D97706",
  },
  descanso: {
    label: "Descanso",
    sublabel: "1 a 2 días sin conexión",
    icon: Coffee,
    headerBg: "#F0FDF4",
    headerText: "#065F46",
    borderColor: "#A7F3D0",
    badgeBg: "#D1FAE5",
    badgeText: "#065F46",
    dotColor: "#059669",
    rowAlt: "#F7FFF9",
    daysColor: "#059669",
  },
};

// ─── Excel export ─────────────────────────────────────────────────────────────
async function exportToExcel(items: OfflineItem[], base: string) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GPS SISTEMA C.A.";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("Revisiones de Equipo", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  // ── Logo ──────────────────────────────────────────────────────────────────
  try {
    const logoResp = await fetch(`${base}logo-gps.png`);
    if (logoResp.ok) {
      const logoBuffer = await logoResp.arrayBuffer();
      const logoId = workbook.addImage({ buffer: logoBuffer, extension: "png" });
      ws.addImage(logoId, "A1:B5" as Parameters<typeof ws.addImage>[1]);
    }
  } catch {
    /* logo optional */
  }

  // ── Column widths ─────────────────────────────────────────────────────────
  ws.columns = [
    { key: "num",      width: 5  },
    { key: "name",     width: 36 },
    { key: "plate",    width: 14 },
    { key: "sim",      width: 18 },
    { key: "model",    width: 20 },
    { key: "install",  width: 22 },
    { key: "lastConn", width: 24 },
    { key: "days",     width: 14 },
    { key: "status",   width: 22 },
  ];

  // ── Company header ────────────────────────────────────────────────────────
  ws.mergeCells("C1:I2");
  const companyCell = ws.getCell("C1");
  companyCell.value = "GPS SISTEMA C.A.";
  companyCell.font = { bold: true, size: 18, color: { argb: "FF0A1A3E" } };
  companyCell.alignment = { vertical: "middle", horizontal: "center" };

  ws.mergeCells("C3:I3");
  const subtitleCell = ws.getCell("C3");
  subtitleCell.value = "Panel Administrativo — Seguimiento de Flota";
  subtitleCell.font = { size: 10, color: { argb: "FF666666" }, italic: true };
  subtitleCell.alignment = { vertical: "middle", horizontal: "center" };

  ws.getRow(4).height = 6;

  // ── Report title ──────────────────────────────────────────────────────────
  ws.mergeCells("A5:I5");
  const titleCell = ws.getCell("A5");
  titleCell.value = "FORMATO DE REVISIONES DE EQUIPO SIN MARCAR";
  titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A1A3E" } };
  ws.getRow(5).height = 28;

  ws.mergeCells("A6:I6");
  const dateCell = ws.getCell("A6");
  dateCell.value = `Generado el ${new Date().toLocaleDateString("es-VE", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  })}`;
  dateCell.font = { size: 9, color: { argb: "FF888888" }, italic: true };
  dateCell.alignment = { horizontal: "right" };

  ws.getRow(7).height = 6;

  // ── Summary ───────────────────────────────────────────────────────────────
  ws.mergeCells("A8:I8");
  const summaryCell = ws.getCell("A8");
  const urgCount  = items.filter((i) => i.category === "urgente").length;
  const contCount = items.filter((i) => i.category === "contacto").length;
  const descCount = items.filter((i) => i.category === "descanso").length;
  summaryCell.value = `Total sin conexión: ${items.length}   |   🔴 Revisión Urgente: ${urgCount}   |   🟡 Contacto con Cliente: ${contCount}   |   🟢 Descanso: ${descCount}`;
  summaryCell.font = { size: 10, bold: true, color: { argb: "FF0A1A3E" } };
  summaryCell.alignment = { horizontal: "center", vertical: "middle" };
  summaryCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FE" } };
  ws.getRow(8).height = 20;

  ws.getRow(9).height = 6;

  // ── Column headers ─────────────────────────────────────────────────────────
  const headerRow = ws.addRow([
    "#", "Nombre / Unidad", "Placa", "Número SIM", "Modelo de Equipo",
    "Fecha de Instalación", "Última Conexión", "Días Sin Conexión", "Estado",
  ]);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A6E" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF2D5A9E" } },
      bottom: { style: "thin", color: { argb: "FF2D5A9E" } },
      left: { style: "thin", color: { argb: "FF2D5A9E" } },
      right: { style: "thin", color: { argb: "FF2D5A9E" } },
    };
  });

  // ── Data rows ─────────────────────────────────────────────────────────────
  const categoryOrder: Category[] = ["urgente", "contacto", "descanso"];
  const catColors: Record<Category, { bg: string; text: string; label: string }> = {
    urgente:  { bg: "FFFEF2F2", text: "FF991B1B", label: "🔴 Revisión Urgente"     },
    contacto: { bg: "FFFEFCE8", text: "FF92400E", label: "🟡 Contacto con Cliente" },
    descanso: { bg: "FFF0FDF4", text: "FF065F46", label: "🟢 Descanso"             },
  };

  let rowNum = 0;

  for (const cat of categoryOrder) {
    const group = items.filter((i) => i.category === cat);
    if (group.length === 0) continue;

    const catRow = ws.addRow(["", catColors[cat].label, "", "", "", "", "", `${group.length} equipo(s)`, ""]);
    ws.mergeCells(`B${catRow.number}:G${catRow.number}`);
    catRow.height = 18;
    catRow.eachCell((cell) => {
      cell.font = { bold: true, size: 10, color: { argb: catColors[cat].text } };
      cell.fill = { type: "pattern", pattern: "solid",
        fgColor: { argb: cat === "urgente" ? "FFFEE2E2" : cat === "contacto" ? "FFFEF3C7" : "FFD1FAE5" } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
    });
    catRow.getCell(8).alignment = { horizontal: "right" };

    for (const item of group) {
      rowNum++;
      const dRow = ws.addRow([
        rowNum,
        item.name,
        item.plate || "—",
        item.simNumber || "—",
        item.model || "—",
        formatLastSeen(item.installationDate) !== "Sin datos" ? formatLastSeen(item.installationDate) : "—",
        formatLastSeen(item.lastConnection),
        item.daysOffline >= 0 ? `${item.daysOffline} día(s)` : "Desconocido",
        cat === "urgente" ? "Revisión Urgente" : cat === "contacto" ? "Contacto Cliente" : "Descanso",
      ]);
      dRow.height = 16;
      dRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: catColors[cat].bg } };
        cell.font = { size: 9 };
        cell.alignment = { vertical: "middle" };
        cell.border = {
          bottom: { style: "hair", color: { argb: "FFCCCCCC" } },
          left:   { style: "hair", color: { argb: "FFCCCCCC" } },
          right:  { style: "hair", color: { argb: "FFCCCCCC" } },
        };
      });
      dRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      dRow.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
      dRow.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
      dRow.getCell(8).alignment = { horizontal: "center", vertical: "middle" };
      dRow.getCell(9).alignment = { horizontal: "center", vertical: "middle" };
      dRow.getCell(9).font = { size: 9, bold: true, color: { argb: catColors[cat].text } };
    }
  }

  ws.addRow([]);
  const footerRow = ws.addRow(["", "GPS SISTEMA C.A. — Confidencial — Uso interno"]);
  ws.mergeCells(`B${footerRow.number}:I${footerRow.number}`);
  footerRow.getCell(2).font = { size: 8, italic: true, color: { argb: "FFAAAAAA" } };

  const dateStr = new Date().toISOString().substring(0, 10);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Revisiones_Equipo_Sin_Marcar_${dateStr}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────
export function Reportes() {
  const [exporting, setExporting] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useGetOfflineReport({
    query: {
      queryKey: getGetOfflineReportQueryKey(),
      refetchInterval: 5 * 60_000,
    },
  });

  const grouped = useMemo(() => {
    const result: Record<Category, OfflineItem[]> = { urgente: [], contacto: [], descanso: [] };
    for (const item of data ?? []) {
      const cat = item.category as Category;
      if (cat in result) result[cat].push(item as OfflineItem);
    }
    return result;
  }, [data]);

  const totalOffline = (data ?? []).length;

  async function handleExport() {
    if (!data || data.length === 0) return;
    setExporting(true);
    try {
      await exportToExcel(data as OfflineItem[], import.meta.env.BASE_URL);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <WifiOff className="w-5 h-5" style={{ color: "#E8720C" }} />
            <h1 className="text-xl font-bold text-gray-900">Reportes de Vehículos</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5 ml-7">
            Equipos sin conexión clasificados por tiempo de inactividad
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 text-gray-600 border-gray-300"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>

          <Button
            size="sm"
            onClick={handleExport}
            disabled={exporting || isLoading || !data || data.length === 0}
            className="h-8 text-white"
            style={{ background: "linear-gradient(135deg, #E8720C, #F5A623)" }}
          >
            {exporting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Generando…
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
                Exportar Excel
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── Summary strip ── */}
      {!isLoading && !isError && (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-3 flex items-center gap-6 shadow-sm flex-wrap">
          <span className="text-sm text-gray-500">
            Total sin conexión:{" "}
            <span className="font-bold text-gray-900">{totalOffline}</span>
          </span>
          {(["urgente", "contacto", "descanso"] as Category[]).map((cat) => {
            const cfg = CATEGORIES[cat];
            return (
              <span key={cat} className="flex items-center gap-1.5 text-sm">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                  style={{ background: cfg.dotColor }}
                />
                <span className="text-gray-500">{cfg.label}:</span>
                <span className="font-bold text-gray-900">{grouped[cat].length}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Loading ── */}
      {isLoading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {isError && (
        <div className="bg-white rounded-xl border border-red-200 flex flex-col items-center justify-center py-16 text-center shadow-sm">
          <WifiOff className="w-12 h-12 text-red-300 mb-3" />
          <p className="text-gray-600 text-sm">
            No se pudo obtener el reporte. Verifica la conexión con la plataforma GPS.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Reintentar
          </Button>
        </div>
      )}

      {/* ── Empty ── */}
      {!isLoading && !isError && totalOffline === 0 && (
        <div className="bg-white rounded-xl border border-emerald-200 flex flex-col items-center justify-center py-20 text-center shadow-sm">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
            <WifiOff className="w-8 h-8 text-emerald-500" />
          </div>
          <p className="text-gray-900 font-semibold text-base">¡Toda la flota está conectada!</p>
          <p className="text-gray-400 text-sm mt-1">No hay vehículos sin conexión en este momento.</p>
        </div>
      )}

      {/* ── Category sections ── */}
      {!isLoading &&
        !isError &&
        (["urgente", "contacto", "descanso"] as Category[]).map((cat) => {
          const items = grouped[cat];
          if (items.length === 0) return null;
          const cfg = CATEGORIES[cat];
          const Icon = cfg.icon;

          return (
            <Card
              key={cat}
              className="border overflow-hidden shadow-sm"
              style={{ borderColor: cfg.borderColor }}
            >
              {/* Section header */}
              <CardHeader
                className="px-5 py-3"
                style={{ background: cfg.headerBg }}
              >
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold"
                    style={{ color: cfg.headerText }}>
                    <Icon className="w-4 h-4" style={{ color: cfg.dotColor }} />
                    {cfg.label}
                    <span className="font-normal text-xs opacity-70 ml-1">— {cfg.sublabel}</span>
                  </CardTitle>
                  <span
                    className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                    style={{ background: cfg.badgeBg, color: cfg.badgeText }}
                  >
                    {items.length} equipo{items.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Nombre / Unidad
                        </th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Placa
                        </th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Número SIM
                        </th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Modelo de Equipo
                        </th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Fecha de Instalación
                        </th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Última Conexión
                        </th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Días
                        </th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Estado
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map((item, idx) => (
                        <tr
                          key={item.id}
                          className="transition-colors hover:bg-gray-50"
                          style={{ background: idx % 2 !== 0 ? cfg.rowAlt : "white" }}
                        >
                          <td className="px-4 py-2.5 font-medium text-gray-900 text-sm">
                            {item.name}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono text-gray-700 text-xs">
                            {item.plate || "—"}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono text-gray-600 text-xs">
                            {item.simNumber || "—"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-600 text-xs">
                            {item.model || "—"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">
                            {formatLastSeen(item.installationDate) !== "Sin datos"
                              ? formatLastSeen(item.installationDate)
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">
                            {formatLastSeen(item.lastConnection)}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className="font-bold text-base"
                              style={{ color: cfg.daysColor }}
                            >
                              {item.daysOffline >= 0 ? item.daysOffline : "?"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
                              style={{ background: cfg.badgeBg, color: cfg.badgeText }}
                            >
                              {cat === "urgente"
                                ? "Urgente"
                                : cat === "contacto"
                                ? "Contacto"
                                : "Descanso"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })}
    </div>
  );
}
