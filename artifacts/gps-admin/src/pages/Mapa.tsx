import { useEffect, useRef, useState, useCallback } from 'react';
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { useGetLivePositions, getGetLivePositionsQueryKey } from '@workspace/api-client-react';
import { getStatusColor, getStatusLabel } from '@/lib/status-colors';
import logoUrl from '/logo-gps.png';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type MapMode = 'streets' | 'satellite';

// ── Types ─────────────────────────────────────────────────────────────────────
interface AlertZone {
  id: number;
  name: string;
  points: [number, number][];
  active: boolean;
  createdAt: string;
}

// ── Animation helpers ─────────────────────────────────────────────────────────
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

interface MarkerState {
  marker: L.CircleMarker;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  progress: number;
  status: string;
}

// ── Tile layer factories ──────────────────────────────────────────────────────
function buildStreetLayers(): L.TileLayer[] {
  return [
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 21,
      maxNativeZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }),
  ];
}

function buildSatelliteLayers(): L.TileLayer[] {
  return [
    L.tileLayer(
      'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      {
        maxZoom: 21,
        maxNativeZoom: 20,
        subdomains: '0123',
        attribution: '© Google',
      }
    ),
  ];
}

// ── Zone colors ───────────────────────────────────────────────────────────────
const ZONE_COLORS = ['#f97316','#3b82f6','#a855f7','#22c55e','#ef4444','#eab308','#06b6d4','#ec4899'];
function zoneColor(idx: number) { return ZONE_COLORS[idx % ZONE_COLORS.length]!; }

// ── API helpers ───────────────────────────────────────────────────────────────
const API = import.meta.env.BASE_URL.replace(/\/$/, '');

async function apiGetZones(): Promise<AlertZone[]> {
  const r = await fetch(`${API}/api/geofences`);
  if (!r.ok) throw new Error('Failed to load zones');
  return r.json() as Promise<AlertZone[]>;
}

async function apiCreateZone(name: string, points: [number, number][]): Promise<AlertZone> {
  const r = await fetch(`${API}/api/geofences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, points }),
  });
  if (!r.ok) throw new Error('Failed to create zone');
  return r.json() as Promise<AlertZone>;
}

async function apiDeleteZone(id: number): Promise<void> {
  await fetch(`${API}/api/geofences/${id}`, { method: 'DELETE' });
}

async function apiToggleZone(id: number, active: boolean): Promise<void> {
  await fetch(`${API}/api/geofences/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active }),
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
export function Mapa() {
  const mapRef         = useRef<L.Map | null>(null);
  const layersRef      = useRef<L.TileLayer[]>([]);
  const statesRef      = useRef<Record<string, MarkerState>>({});
  const animRef        = useRef<number | null>(null);
  const zoneLayersRef  = useRef<Map<number, L.Polygon>>(new Map());
  const drawLayerRef   = useRef<L.LayerGroup | null>(null);
  const drawPointsRef  = useRef<[number, number][]>([]);

  const [time, setTime]           = useState(new Date());
  const [mode, setMode]           = useState<MapMode>('streets');
  const [counts, setCounts]       = useState({ moving: 0, ack: 0, idle: 0, off: 0, total: 0, hidden: 0 });
  const [zones, setZones]         = useState<AlertZone[]>([]);
  const [drawing, setDrawing]     = useState(false);
  const [drawPts, setDrawPts]     = useState<[number, number][]>([]);
  const [zonesOpen, setZonesOpen] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saveErr, setSaveErr]     = useState('');

  const { data: positions } = useGetLivePositions({
    query: { refetchInterval: 1000, queryKey: getGetLivePositionsQueryKey() },
  });

  // Load zones from API
  const loadZones = useCallback(async () => {
    try {
      const data = await apiGetZones();
      setZones(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void loadZones(); }, [loadZones]);

  // Clock
  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Init map (once)
  useEffect(() => {
    if (mapRef.current) return;

    const map = L.map('live-map', {
      zoomControl: true,
      attributionControl: false,
    }).setView([8.5, -66.5], 6);

    const layers = buildStreetLayers();
    layers.forEach(l => l.addTo(map));
    layersRef.current = layers;

    const drawLayer = L.layerGroup().addTo(map);
    drawLayerRef.current = drawLayer;

    mapRef.current = map;
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch tile layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    layersRef.current.forEach(l => map.removeLayer(l));
    const newLayers = mode === 'streets' ? buildStreetLayers() : buildSatelliteLayers();
    newLayers.forEach(l => l.addTo(map));
    layersRef.current = newLayers;
  }, [mode]);

  // Render zone polygons on the map whenever zones list changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove all old zone layers
    zoneLayersRef.current.forEach(poly => map.removeLayer(poly));
    zoneLayersRef.current.clear();

    zones.forEach((zone, idx) => {
      if (!zone.active) return;
      const color = zoneColor(idx);
      const poly = L.polygon(zone.points, {
        color,
        fillColor: color,
        fillOpacity: 0.15,
        weight: 2.5,
        dashArray: '6 4',
      });

      poly.bindPopup(`
        <div style="font-family:'Inter',sans-serif;min-width:180px">
          <div style="font-weight:900;font-size:14px;margin-bottom:8px">📌 ${zone.name}</div>
          <div style="font-size:11px;color:#64748b;margin-bottom:10px">${zone.points.length} vértices</div>
          <button onclick="window.__deleteZone(${zone.id})"
            style="width:100%;padding:6px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer">
            🗑️ Eliminar zona
          </button>
        </div>
      `, { maxWidth: 220 });

      poly.addTo(map);
      zoneLayersRef.current.set(zone.id, poly);
    });
  }, [zones]);

  // Global delete handler (called from popup)
  useEffect(() => {
    (window as unknown as Record<string, unknown>)['__deleteZone'] = async (id: number) => {
      await apiDeleteZone(id);
      await loadZones();
    };
    return () => { delete (window as unknown as Record<string, unknown>)['__deleteZone']; };
  }, [loadZones]);

  // Drawing mode: attach/detach map click handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (drawing) {
      map.getContainer().style.cursor = 'crosshair';
    } else {
      map.getContainer().style.cursor = '';
    }

    const handleClick = (e: L.LeafletMouseEvent) => {
      if (!drawing) return;
      const pt: [number, number] = [e.latlng.lat, e.latlng.lng];
      drawPointsRef.current = [...drawPointsRef.current, pt];
      setDrawPts([...drawPointsRef.current]);
    };

    if (drawing) {
      map.on('click', handleClick);
    }
    return () => { map.off('click', handleClick); };
  }, [drawing]);

  // Render draw preview
  useEffect(() => {
    const map = mapRef.current;
    const layer = drawLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    if (drawPts.length === 0) return;

    // Draw vertex dots
    drawPts.forEach((pt, i) => {
      L.circleMarker(pt, {
        radius: i === 0 ? 7 : 5,
        color: '#f97316',
        fillColor: i === 0 ? '#fff' : '#f97316',
        fillOpacity: 1,
        weight: 2.5,
      }).addTo(layer);
    });

    // Draw dashed preview polygon if ≥3 points
    if (drawPts.length >= 3) {
      L.polygon(drawPts, {
        color: '#f97316',
        fillColor: '#f97316',
        fillOpacity: 0.12,
        weight: 2,
        dashArray: '8 5',
      }).addTo(layer);
    } else if (drawPts.length === 2) {
      L.polyline(drawPts, { color: '#f97316', weight: 2, dashArray: '8 5' }).addTo(layer);
    }
  }, [drawPts]);

  // Animation loop
  useEffect(() => {
    let running = true;
    let last = performance.now();
    const DURATION = 900;

    function tick(now: number) {
      if (!running) return;
      const dt = now - last;
      last = now;
      for (const s of Object.values(statesRef.current)) {
        if (s.status === 'moving' && s.progress < 1) {
          s.progress = Math.min(1, s.progress + dt / DURATION);
          s.marker.setLatLng([
            lerp(s.fromLat, s.toLat, s.progress),
            lerp(s.fromLng, s.toLng, s.progress),
          ]);
        }
      }
      animRef.current = requestAnimationFrame(tick);
    }
    animRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  // Update vehicle markers
  useEffect(() => {
    if (!mapRef.current || !positions) return;
    const map = mapRef.current;
    const states = statesRef.current;
    const activeIds = new Set<string>();
    const now = Date.now();
    let moving = 0, ack = 0, idle = 0, off = 0, hidden = 0;

    positions.forEach(pos => {
      if (pos.lat === null || pos.lng === null) return;

      const lastConn = pos.lastConnection ? new Date(pos.lastConnection).getTime() : 0;
      const isDisc   = pos.status === 'disconnected_blue' || pos.status === 'disconnected_red';
      if (isDisc && lastConn > 0 && (now - lastConn) > SEVEN_DAYS_MS) { hidden++; return; }

      activeIds.add(pos.id);
      const color   = getStatusColor(pos.status);
      const isMoving = pos.status === 'moving';

      if (isMoving) moving++;
      else if (pos.status === 'ack') ack++;
      else if (pos.status === 'engine_idle') idle++;
      else if (isDisc) off++;

      const rows: [string, string][] = [
        ['Placa',    pos.plate || '—'],
        ['Vehículo', pos.name  || '—'],
        ['Estado',   `<span style="color:${color};font-weight:700">${getStatusLabel(pos.status)}</span>`],
      ];
      if (pos.model)  rows.push(['Modelo',    pos.model]);
      if (pos.driver) rows.push(['Conductor', pos.driver]);
      if (pos.imei)   rows.push(['IMEI', `<span style="font-family:monospace;font-size:11px">${pos.imei}</span>`]);
      if (pos.simNumber) rows.push(['SIM', pos.simNumber]);
      if (pos.lastConnection) rows.push(['Últ. conexión', new Date(pos.lastConnection).toLocaleString('es-VE')]);

      const sensorRows: [string, string][] = [];
      const motorColor = pos.engineStatus ? '#22c55e' : '#94a3b8';
      sensorRows.push(['Motor', `<b style="color:${motorColor}">${pos.engineStatus ? 'ON ✓' : 'OFF'}</b>`]);
      if (pos.speed !== null && pos.speed !== undefined) {
        const sp = pos.speed ?? 0;
        sensorRows.push(['Velocidad', `<b style="color:${sp > 90 ? '#ef4444' : sp > 0 ? '#22c55e' : '#94a3b8'}">${sp} km/h${sp > 90 ? ' ⚠️' : ''}</b>`]);
      }
      if (pos.totalDistance !== null && pos.totalDistance !== undefined && pos.totalDistance > 0) {
        sensorRows.push(['Odómetro', `${pos.totalDistance.toLocaleString('es-VE', { maximumFractionDigits: 1 })} km`]);
      }
      if (pos.stopDurationSec !== null && pos.stopDurationSec !== undefined && pos.stopDurationSec > 0 && pos.status !== 'moving') {
        const mins = Math.floor(pos.stopDurationSec / 60);
        const hrs  = Math.floor(mins / 60);
        sensorRows.push(['Tiempo det.', hrs > 0 ? `${hrs}h ${mins % 60}m parado` : `${mins}m parado`]);
      }
      if (pos.altitude !== null && pos.altitude !== undefined && pos.altitude > 0) {
        sensorRows.push(['Altitud', `${pos.altitude} m`]);
      }
      if (pos.heading !== null && pos.heading !== undefined) {
        const dirs = ['N','NE','E','SE','S','SO','O','NO'];
        const dir  = dirs[Math.round((pos.heading ?? 0) / 45) % 8];
        sensorRows.push(['Curso', `${pos.heading}° ${dir}`]);
      }
      if (pos.engineHours) sensorRows.push(['Horas Motor', `<b>${pos.engineHours}</b>`]);
      if (pos.batteryLevel) {
        const bv = parseFloat(pos.batteryLevel);
        const bColor = bv >= 70 ? '#22c55e' : bv >= 30 ? '#eab308' : '#ef4444';
        sensorRows.push(['Batería', `<b style="color:${bColor}">${pos.batteryLevel}</b>`]);
      }
      if (pos.gsmSignal !== null && pos.gsmSignal !== undefined) {
        const gsm = pos.gsmSignal;
        const gsmColor = gsm >= 70 ? '#22c55e' : gsm >= 40 ? '#eab308' : '#ef4444';
        const gsmBars  = gsm >= 75 ? '▂▄▆█' : gsm >= 50 ? '▂▄▆░' : gsm >= 25 ? '▂▄░░' : '▂░░░';
        sensorRows.push(['GSM', `<b style="color:${gsmColor}">${gsmBars} ${Math.round(gsm)}%${gsm < 40 ? ' ⚠️' : ''}</b>`]);
      }

      const popup = `
        <div style="font-family:'Inter',sans-serif;min-width:250px;max-width:290px">
          <div style="background:${color};padding:10px 14px;border-radius:10px 10px 0 0;margin:-8px -8px 0 -8px">
            <div style="font-size:17px;font-weight:900;color:#fff;letter-spacing:0.02em">${pos.plate || pos.name}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.82);margin-top:2px">${pos.name}</div>
          </div>
          <div style="padding:8px 0 2px 0">
            ${rows.map(([k, v]) => `
              <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:4px 0;border-bottom:1px solid #f1f5f9">
                <span style="font-size:11px;color:#94a3b8;font-weight:600;white-space:nowrap;margin-right:8px">${k}</span>
                <span style="font-size:12px;color:#1e293b;text-align:right">${v}</span>
              </div>`).join('')}
          </div>
          <div style="margin-top:6px;padding:8px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
            <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">⚙️ Sensores</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
              ${sensorRows.map(([k, v]) => `
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:5px 7px">
                  <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.06em">${k}</div>
                  <div style="font-size:12px;color:#0f172a;font-weight:700;margin-top:1px">${v}</div>
                </div>`).join('')}
            </div>
          </div>
          ${pos.lat && pos.lng ? `
          <a href="https://maps.google.com/?q=${pos.lat},${pos.lng}" target="_blank"
             style="display:block;text-align:center;margin-top:8px;padding:6px;background:#f0f9ff;border-radius:7px;font-size:12px;color:#2563eb;text-decoration:none;font-weight:700;border:1px solid #bfdbfe">
            📍 Ver en Google Maps
          </a>` : ''}
        </div>
      `;

      const radius      = isMoving ? 9 : isDisc ? 5 : 7;
      const fillOpacity = isDisc ? 0.55 : 0.92;

      if (states[pos.id]) {
        const s = states[pos.id]!;
        const cur = s.marker.getLatLng();
        if (isMoving && (Math.abs(pos.lat - s.toLat) > 0.00005 || Math.abs(pos.lng - s.toLng) > 0.00005)) {
          s.fromLat = cur.lat; s.fromLng = cur.lng;
          s.toLat = pos.lat;   s.toLng = pos.lng;
          s.progress = 0;
        } else if (!isMoving) {
          s.marker.setLatLng([pos.lat, pos.lng]);
          s.toLat = pos.lat; s.toLng = pos.lng;
        }
        if (s.status !== pos.status) {
          s.marker.setStyle({ fillColor: color, color, radius, fillOpacity });
          s.status = pos.status;
        }
        s.marker.getPopup()?.setContent(popup);
      } else {
        const marker = L.circleMarker([pos.lat, pos.lng], {
          radius, fillColor: color, color, weight: 2, opacity: 1, fillOpacity,
        }).bindPopup(popup, { maxWidth: 290, className: 'gps-popup' });
        marker.addTo(map);
        states[pos.id] = {
          marker, fromLat: pos.lat, fromLng: pos.lng,
          toLat: pos.lat, toLng: pos.lng, progress: 1, status: pos.status,
        };
      }
    });

    for (const id of Object.keys(states)) {
      if (!activeIds.has(id)) { map.removeLayer(states[id]!.marker); delete states[id]; }
    }

    setCounts({ moving, ack, idle, off, total: activeIds.size, hidden });
  }, [positions]);

  // ── Drawing actions ───────────────────────────────────────────────────────

  const startDrawing = () => {
    drawPointsRef.current = [];
    setDrawPts([]);
    setDrawing(true);
    setZonesOpen(false);
    setSaveErr('');
  };

  const cancelDrawing = () => {
    setDrawing(false);
    drawPointsRef.current = [];
    setDrawPts([]);
    drawLayerRef.current?.clearLayers();
  };

  const undoLastPoint = () => {
    const pts = drawPointsRef.current.slice(0, -1);
    drawPointsRef.current = pts;
    setDrawPts([...pts]);
  };

  const saveZone = async () => {
    const pts = drawPointsRef.current;
    if (pts.length < 3) { setSaveErr('Necesitas al menos 3 puntos para crear una zona.'); return; }
    const name = window.prompt('Nombre de la zona de alerta (ej: Coloncito, Frontera Táchira):');
    if (!name?.trim()) return;
    setSaving(true);
    setSaveErr('');
    try {
      await apiCreateZone(name.trim(), pts);
      await loadZones();
      cancelDrawing();
      setZonesOpen(true);
    } catch {
      setSaveErr('Error al guardar la zona. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const toggleZone = async (id: number, active: boolean) => {
    await apiToggleZone(id, active);
    await loadZones();
  };

  const deleteZone = async (id: number) => {
    if (!window.confirm('¿Eliminar esta zona de alerta?')) return;
    await apiDeleteZone(id);
    await loadZones();
  };

  const isSat = mode === 'satellite';
  const activeZones = zones.filter(z => z.active);

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <div id="live-map" className="w-full h-full z-0" />

      {/* ── Centro de Control ── */}
      <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none">
        <div
          className="pointer-events-auto rounded-2xl overflow-hidden shadow-2xl"
          style={{
            background: 'linear-gradient(135deg, rgba(5,10,28,0.96) 0%, rgba(8,18,48,0.96) 50%, rgba(5,10,28,0.96) 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, #E8720C 0%, #1E6FBF 50%, #5B9B2A 100%)' }} />

          <div className="flex items-stretch">
            <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderRight: '1px solid rgba(255,255,255,0.07)' }}>
              <img src={logoUrl} alt="GPS Sistema C.A." className="h-12 w-12 object-contain drop-shadow-lg" />
              <div>
                <div className="text-[13px] font-black text-white tracking-tight leading-tight">GPS SISTEMA C.A.</div>
                <div className="text-[8px] font-bold tracking-[0.25em] uppercase mt-0.5" style={{ color: '#E8720C' }}>Centro de Monitoreo</div>
                <div className="text-[8px] text-white/35 tracking-[0.15em] uppercase mt-0.5">rastreoplus247.com</div>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center px-5 shrink-0" style={{ borderRight: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="text-[8px] font-bold text-white/35 uppercase tracking-widest mb-0.5">Hora Local</div>
              <div className="text-xl font-mono font-black tabular-nums" style={{ color: '#38bdf8', textShadow: '0 0 16px rgba(56,189,248,0.5)' }}>
                {time.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <div className="text-[8px] text-white/25 mt-0.5">
                {time.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            </div>

            <div className="flex flex-1 divide-x" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              {([
                { label: 'En Mapa',         value: counts.total,  color: '#e2e8f0', glow: 'rgba(226,232,240,0.3)', pulse: false },
                { label: 'En Movimiento',   value: counts.moving, color: '#22c55e', glow: 'rgba(34,197,94,0.5)',   pulse: true  },
                { label: 'ACK / Encendido', value: counts.ack,    color: '#eab308', glow: 'rgba(234,179,8,0.5)',   pulse: false },
                { label: 'Motor Ralentí',   value: counts.idle,   color: '#f97316', glow: 'rgba(249,115,22,0.5)',  pulse: false },
                { label: 'Desconectados',   value: counts.off,    color: '#3b82f6', glow: 'rgba(59,130,246,0.5)',  pulse: false },
                { label: 'Ocultos >7d',     value: counts.hidden, color: '#475569', glow: 'rgba(71,85,105,0.3)',   pulse: false },
              ] as const).map((s) => (
                <div
                  key={s.label}
                  className="flex-1 flex flex-col items-center justify-center py-3 px-2 relative"
                  style={{ borderColor: 'rgba(255,255,255,0.06)', minWidth: 0 }}
                >
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background: `radial-gradient(ellipse at 50% 100%, ${s.glow.replace('0.5','0.06')} 0%, transparent 70%)` }} />
                  {s.pulse && (
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full"
                      style={{ background: s.color, boxShadow: `0 0 8px ${s.color}`, animation: 'pulse 1.4s infinite' }} />
                  )}
                  <div className="text-3xl font-black tabular-nums leading-none relative z-10"
                    style={{ color: s.color, textShadow: `0 0 20px ${s.glow}, 0 0 40px ${s.glow.replace('0.5','0.25')}` }}>
                    {s.value}
                  </div>
                  <div className="text-[8px] font-bold uppercase tracking-[0.15em] mt-1 text-center leading-tight relative z-10"
                    style={{ color: `${s.color}88` }}>
                    {s.label}
                  </div>
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full transition-all"
                    style={{ width: '60%', background: s.color, opacity: 0.5, boxShadow: `0 0 8px ${s.color}` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Top-right controls ── */}
      <div className="absolute top-3 right-3 z-20 pointer-events-auto flex flex-col gap-2 items-end">
        {/* Map mode toggle */}
        <div className="bg-[#05111f]/90 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl p-1 flex gap-1">
          <button onClick={() => setMode('streets')} className="px-3 py-2 rounded-lg text-xs font-bold transition-all"
            style={!isSat ? { background:'linear-gradient(135deg,#0A1A3E,#0D2255)', color:'#60a5fa', border:'1px solid rgba(96,165,250,0.4)', boxShadow:'0 0 12px rgba(96,165,250,0.2)' }
                          : { color:'rgba(255,255,255,0.4)', border:'1px solid transparent' }}>
            🗺️ Calles
          </button>
          <button onClick={() => setMode('satellite')} className="px-3 py-2 rounded-lg text-xs font-bold transition-all"
            style={isSat  ? { background:'linear-gradient(135deg,#0A1A3E,#0D2255)', color:'#22c55e', border:'1px solid rgba(34,197,94,0.4)', boxShadow:'0 0 12px rgba(34,197,94,0.2)' }
                          : { color:'rgba(255,255,255,0.4)', border:'1px solid transparent' }}>
            🛰️ Satélite
          </button>
        </div>

        {/* Zones button */}
        {!drawing && (
          <button
            onClick={() => setZonesOpen(o => !o)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold shadow-2xl transition-all"
            style={{
              background: zonesOpen
                ? 'linear-gradient(135deg,#7c3aed,#6d28d9)'
                : 'linear-gradient(135deg,#1e293b,#0f172a)',
              color: zonesOpen ? '#fff' : 'rgba(255,255,255,0.7)',
              border: zonesOpen ? '1px solid rgba(167,139,250,0.5)' : '1px solid rgba(255,255,255,0.1)',
              boxShadow: zonesOpen ? '0 0 16px rgba(139,92,246,0.4)' : undefined,
            }}
          >
            🚧 Geocercas
            {activeZones.length > 0 && (
              <span className="ml-1 bg-orange-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">
                {activeZones.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* ── Zones panel ── */}
      {zonesOpen && !drawing && (
        <div className="absolute top-36 right-3 z-20 w-72 pointer-events-auto"
          style={{
            background: 'rgba(5,10,28,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            backdropFilter: 'blur(16px)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span className="text-white font-black text-sm">🚧 Zonas de Alerta</span>
            <button onClick={() => setZonesOpen(false)} className="text-white/40 hover:text-white text-lg leading-none">×</button>
          </div>

          <div className="p-3">
            <button
              onClick={startDrawing}
              className="w-full py-2.5 rounded-xl text-sm font-black mb-3 transition-all"
              style={{
                background: 'linear-gradient(135deg,#f97316,#ea580c)',
                color: '#fff',
                boxShadow: '0 4px 16px rgba(249,115,22,0.4)',
              }}
            >
              ✏️ Dibujar Nueva Zona
            </button>

            {zones.length === 0 ? (
              <div className="text-center py-6 text-white/30 text-xs">
                <div className="text-3xl mb-2">🗺️</div>
                No hay zonas configuradas.<br />
                Dibuja la primera zona en el mapa.
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
                {zones.map((zone, idx) => (
                  <div key={zone.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ background: zoneColor(idx), boxShadow: `0 0 6px ${zoneColor(idx)}` }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-bold truncate">{zone.name}</div>
                      <div className="text-white/30 text-[10px]">{zone.points.length} vértices</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => toggleZone(zone.id, !zone.active)}
                        className="text-[10px] px-2 py-1 rounded-lg font-bold transition-all"
                        style={{
                          background: zone.active ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
                          color: zone.active ? '#22c55e' : 'rgba(255,255,255,0.3)',
                          border: `1px solid ${zone.active ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
                        }}
                      >
                        {zone.active ? 'ON' : 'OFF'}
                      </button>
                      <button onClick={() => deleteZone(zone.id)}
                        className="text-[11px] px-2 py-1 rounded-lg font-bold transition-all hover:opacity-80"
                        style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Drawing toolbar ── */}
      {drawing && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
          <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl"
            style={{
              background: 'rgba(5,10,28,0.97)',
              border: '1px solid rgba(249,115,22,0.4)',
              backdropFilter: 'blur(16px)',
              boxShadow: '0 8px 32px rgba(249,115,22,0.25)',
            }}>
            <div className="flex items-center gap-2 text-orange-400 font-black text-sm">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-400 animate-pulse" />
              Modo dibujo
            </div>
            <div className="text-white/30 text-xs">
              {drawPts.length === 0
                ? 'Haz clic en el mapa para agregar puntos'
                : drawPts.length < 3
                ? `${drawPts.length} punto${drawPts.length > 1 ? 's' : ''} — necesitas al menos 3`
                : `${drawPts.length} puntos`}
            </div>
            {drawPts.length > 0 && (
              <button onClick={undoLastPoint}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
                ↩ Deshacer
              </button>
            )}
            {saveErr && <span className="text-red-400 text-xs">{saveErr}</span>}
            <button onClick={cancelDrawing}
              className="px-3 py-1.5 rounded-lg text-xs font-bold"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
              Cancelar
            </button>
            <button onClick={() => { void saveZone(); }}
              disabled={drawPts.length < 3 || saving}
              className="px-4 py-1.5 rounded-lg text-xs font-black transition-all disabled:opacity-40"
              style={{
                background: drawPts.length >= 3 && !saving
                  ? 'linear-gradient(135deg,#22c55e,#16a34a)'
                  : 'rgba(255,255,255,0.08)',
                color: drawPts.length >= 3 && !saving ? '#fff' : 'rgba(255,255,255,0.3)',
                border: 'none',
                boxShadow: drawPts.length >= 3 ? '0 4px 12px rgba(34,197,94,0.3)' : undefined,
              }}>
              {saving ? 'Guardando…' : '✓ Guardar Zona'}
            </button>
          </div>
        </div>
      )}

      {/* ── Legend ── */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <div className="bg-[#05111f]/90 backdrop-blur-md border border-white/10 px-5 py-2 rounded-full shadow-2xl pointer-events-auto flex items-center gap-5">
          {[
            { color: '#22c55e', label: 'En Movimiento' },
            { color: '#eab308', label: 'ACK'           },
            { color: '#f97316', label: 'Ralentí'       },
            { color: '#3b82f6', label: 'Desconectado'  },
            { color: '#ef4444', label: 'Sin Señal'     },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: item.color, boxShadow: `0 0 6px ${item.color}88` }} />
              <span className="text-xs font-medium text-white/70">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Attribution ── */}
      <div className="absolute bottom-5 right-3 z-10">
        <div className="bg-[#05111f]/90 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-lg text-[10px] font-bold text-white/40 uppercase tracking-wider">
          {isSat ? '🛰 Satélite · Esri · 1s' : '🗺 OpenStreetMap · 1s'}
        </div>
      </div>

      <style>{`
        .gps-popup .leaflet-popup-content-wrapper {
          border-radius: 12px; padding: 8px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
          border: 1px solid #e2e8f0;
        }
        .gps-popup .leaflet-popup-content { margin: 0; }
        .gps-popup .leaflet-popup-tip { background: #fff; }
      `}</style>
    </div>
  );
}
