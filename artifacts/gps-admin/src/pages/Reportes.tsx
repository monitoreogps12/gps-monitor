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
    badgeClass: string;
    rowBg: string;
    headerBg: string;
    borderColor: string;
    dotColor: string;
  }
> = {
  urgente: {
    label: "Revisión Urgente",
    sublabel: "7 días o más sin conexión",
    icon: AlertTriangle,
    badgeClass: "bg-red-100 text-red-800 border-red-300",
    rowBg: "bg-red-50/60 hover:bg-red-50",
    headerBg: "bg-red-600",
    borderColor: "border-red-300",
    dotColor: "#dc2626",
  },
  contacto: {
    label: "Contacto con Cliente",
    sublabel: "3 a 7 días sin conexión",
    icon: Phone,
    badgeClass: "bg-amber-100 text-amber-800 border-amber-300",
    rowBg: "bg-amber-50/60 hover:bg-amber-50",
    headerBg: "bg-amber-500",
    borderColor: "border-amber-300",
    dotColor: "#d97706",
  },
  descanso: {
    label: "Descanso",
    sublabel: "1 a 2 días sin conexión",
    icon: Coffee,
    badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300",
    rowBg: "bg-emerald-50/60 hover:bg-emerald-50",
    headerBg: "bg-emerald-600",
    borderColor: "border-emerald-300",
    dotColor: "#059669",
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
      // Use cell-range string to avoid strict Anchor type requirements
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

  // ── Company header (rows 1-3, right of logo) ──────────────────────────────
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

  // ── Report title (row 5-6) ────────────────────────────────────────────────
  ws.getRow(4).height = 6;

  ws.mergeCells("A5:I5");
  const titleCell = ws.getCell("A5");
  titleCell.value = "FORMATO DE REVISIONES DE EQUIPO SIN MARCAR";
  titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0A1A3E" },
  };
  ws.getRow(5).height = 28;

  ws.mergeCells("A6:I6");
  const dateCell = ws.getCell("A6");
  dateCell.value = `Generado el ${new Date().toLocaleDateString("es-VE", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
  dateCell.font = { size: 9, color: { argb: "FF888888" }, italic: true };
  dateCell.alignment = { horizontal: "right" };

  // ── Summary row ───────────────────────────────────────────────────────────
  ws.getRow(7).height = 6;

  ws.mergeCells("A8:I8");
  const summaryCell = ws.getCell("A8");
  const urgCount = items.filter((i) => i.category === "urgente").length;
  const contCount = items.filter((i) => i.category === "contacto").length;
  const descCount = items.filter((i) => i.category === "descanso").length;
  summaryCell.value = `Total sin conexión: ${items.length}   |   🔴 Revisión Urgente: ${urgCount}   |   🟡 Contacto con Cliente: ${contCount}   |   🟢 Descanso: ${descCount}`;
  summaryCell.font = { size: 10, bold: true, color: { argb: "FF0A1A3E" } };
  summaryCell.alignment = { horizontal: "center", vertical: "middle" };
  summaryCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8F0FE" },
  };
  ws.getRow(8).height = 20;

  ws.getRow(9).height = 6;

  // ── Column headers ─────────────────────────────────────────────────────────
  const headerRow = ws.addRow([
    "#",
    "Nombre / Unidad",
    "Placa",
    "Número SIM",
    "Modelo de Equipo",
    "Fecha de Instalación",
    "Última Conexión",
    "Días Sin Conexión",
    "Estado",
  ]);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A6E" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF2D5A9E" } },
      bottom: { style: "thin", color: { argb: "FF2D5A9E" } },
      left: { style: "thin", color: { argb: "FF2D5A9E" } },
      right: { style: "thin", color: { argb: "FF2D5A9E" } },
    };
  });

  // ── Data rows grouped by category ─────────────────────────────────────────
  const categoryOrder: Category[] = ["urgente", "contacto", "descanso"];
  const categoryColors: Record<Category, { bg: string; text: string; label: string }> = {
    urgente:  { bg: "FFFEF2F2", text: "FF991B1B", label: "🔴 Revisión Urgente"     },
    contacto: { bg: "FFFEFCE8", text: "FF92400E", label: "🟡 Contacto con Cliente" },
    descanso: { bg: "FFF0FDF4", text: "FF065F46", label: "🟢 Descanso"             },
  };

  let rowNum = 0;

  for (const cat of categoryOrder) {
    const group = items.filter((i) => i.category === cat);
    if (group.length === 0) continue;

    // Category section header
    const catHeaderRow = ws.addRow([
      "",
      categoryColors[cat].label,
      "",
      "",
      "",
      "",
      "",
      `${group.length} equipo(s)`,
      "",
    ]);
    ws.mergeCells(`B${catHeaderRow.number}:G${catHeaderRow.number}`);
    catHeaderRow.height = 18;
    catHeaderRow.eachCell((cell) => {
      cell.font = { bold: true, size: 10, color: { argb: categoryColors[cat].text } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: cat === "urgente" ? "FFFEE2E2" : cat === "contacto" ? "FFFEF3C7" : "FFD1FAE5" },
      };
      cell.alignment = { vertical: "middle", horizontal: "left" };
    });
    catHeaderRow.getCell(8).alignment = { horizontal: "right" };

    for (const item of group) {
      rowNum++;
      const dRow = ws.addRow([
        rowNum,
        item.name,
        item.plate || "—",
        item.simNumber || "—",
        item.model || "—",
        item.installationDate || "—",
        item.lastConnection || "—",
        item.daysOffline >= 0 ? `${item.daysOffline} día(s)` : "Desconocido",
        cat === "urgente" ? "Revisión Urgente" : cat === "contacto" ? "Contacto Cliente" : "Descanso",
      ]);
      dRow.height = 16;
      dRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: categoryColors[cat].bg },
        };
        cell.font = { size: 9 };
        cell.alignment = { vertical: "middle", wrapText: false };
        cell.border = {
          bottom: { style: "hair", color: { argb: "FFCCCCCC" } },
          left: { style: "hair", color: { argb: "FFCCCCCC" } },
          right: { style: "hair", color: { argb: "FFCCCCCC" } },
        };
      });
      dRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      dRow.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
      dRow.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
      dRow.getCell(8).alignment = { horizontal: "center", vertical: "middle" };
      dRow.getCell(9).alignment = { horizontal: "center", vertical: "middle" };
      dRow.getCell(9).font = {
        size: 9,
        bold: true,
        color: { argb: categoryColors[cat].text },
      };
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  ws.addRow([]);
  const footerRow = ws.addRow(["", "GPS SISTEMA C.A. — Confidencial — Uso interno"]);
  ws.mergeCells(`B${footerRow.number}:I${footerRow.number}`);
  footerRow.getCell(2).font = { size: 8, italic: true, color: { argb: "FFAAAAAA" } };

  // ── Download ──────────────────────────────────────────────────────────────
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
    const cats: Category[] = ["urgente", "contacto", "descanso"];
    const result: Record<Category, OfflineItem[]> = {
      urgente: [],
      contacto: [],
      descanso: [],
    };
    for (const item of data ?? []) {
      const cat = item.category as Category;
      if (cats.includes(cat)) result[cat].push(item as OfflineItem);
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
    <div className="flex flex-col h-full">
      {/* ── Page header ── */}
      <div
        className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <div>
          <div className="flex items-center gap-2">
            <WifiOff className="w-5 h-5" style={{ color: "#E8720C" }} />
            <h1 className="text-lg font-bold text-white">Reportes de Vehículos</h1>
          </div>
          <p className="text-xs text-white/40 mt-0.5 ml-7">
            Equipos sin conexión clasificados por tiempo de inactividad
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="border-white/10 text-white/60 hover:text-white hover:bg-white/5 h-8"
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
        <div
          className="px-6 py-2.5 flex items-center gap-6 border-b flex-shrink-0"
          style={{
            background: "rgba(255,255,255,0.03)",
            borderColor: "rgba(255,255,255,0.06)",
          }}
        >
          <span className="text-xs text-white/50">
            Total sin conexión:{" "}
            <span className="font-bold text-white">{totalOffline}</span>
          </span>
          {(["urgente", "contacto", "descanso"] as Category[]).map((cat) => {
            const cfg = CATEGORIES[cat];
            return (
              <span key={cat} className="flex items-center gap-1.5 text-xs">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ background: cfg.dotColor }}
                />
                <span className="text-white/50">{cfg.label}:</span>
                <span className="font-bold text-white">{grouped[cat].length}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto px-6 py-4 space-y-5">
        {isLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl bg-white/5" />
            ))}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <WifiOff className="w-12 h-12 text-white/20 mb-3" />
            <p className="text-white/50 text-sm">
              No se pudo obtener el reporte. Verifica la conexión con la plataforma GPS.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 border-white/10 text-white/60 hover:text-white"
              onClick={() => refetch()}
            >
              Reintentar
            </Button>
          </div>
        )}

        {!isLoading && !isError && totalOffline === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ background: "rgba(5,150,105,0.15)" }}
            >
              <WifiOff className="w-8 h-8" style={{ color: "#059669" }} />
            </div>
            <p className="text-white font-semibold text-base">
              ¡Toda la flota está conectada!
            </p>
            <p className="text-white/40 text-sm mt-1">
              No hay vehículos sin conexión en este momento.
            </p>
          </div>
        )}

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
                className={`border overflow-hidden ${cfg.borderColor}`}
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                {/* Section header */}
                <CardHeader
                  className="px-4 py-3"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-sm font-bold text-white">
                      <Icon className="w-4 h-4" style={{ color: cfg.dotColor }} />
                      {cfg.label}
                      <span className="text-white/40 font-normal text-xs">
                        — {cfg.sublabel}
                      </span>
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={`text-xs px-2 py-0.5 ${cfg.badgeClass}`}
                    >
                      {items.length} equipo{items.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr
                          className="border-b text-white/50 font-semibold uppercase tracking-wide text-[10px]"
                          style={{ borderColor: "rgba(255,255,255,0.06)" }}
                        >
                          <th className="px-4 py-2 text-left">Nombre / Unidad</th>
                          <th className="px-3 py-2 text-center">Placa</th>
                          <th className="px-3 py-2 text-center">Número SIM</th>
                          <th className="px-3 py-2 text-left">Modelo de Equipo</th>
                          <th className="px-3 py-2 text-left">Fecha de Instalación</th>
                          <th className="px-3 py-2 text-left">Última Conexión</th>
                          <th className="px-3 py-2 text-center">Días</th>
                          <th className="px-3 py-2 text-center">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, idx) => (
                          <tr
                            key={item.id}
                            className="border-b transition-colors"
                            style={{
                              borderColor: "rgba(255,255,255,0.04)",
                              background:
                                idx % 2 === 0
                                  ? "rgba(255,255,255,0.02)"
                                  : "transparent",
                            }}
                          >
                            <td className="px-4 py-2.5 font-medium text-white">
                              {item.name}
                            </td>
                            <td className="px-3 py-2.5 text-center font-mono text-white/80">
                              {item.plate || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-center font-mono text-white/70">
                              {item.simNumber || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-white/70">
                              {item.model || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-white/60">
                              {item.installationDate || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-white/60">
                              {item.lastConnection || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span
                                className="font-bold text-sm"
                                style={{ color: cfg.dotColor }}
                              >
                                {item.daysOffline >= 0 ? item.daysOffline : "?"}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cfg.badgeClass}`}
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
    </div>
  );
}
