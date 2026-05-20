import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { useGetLivePositions, getGetLivePositionsQueryKey } from '@workspace/api-client-react';
import { getStatusColor, getStatusLabel } from '@/lib/status-colors';
import logoUrl from '/logo.png';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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

export function Mapa() {
  const mapRef = useRef<L.Map | null>(null);
  const statesRef = useRef<Record<string, MarkerState>>({});
  const animRef = useRef<number | null>(null);
  const [time, setTime] = useState(new Date());
  const [counts, setCounts] = useState({ moving: 0, ack: 0, idle: 0, off: 0, total: 0, hidden: 0 });

  const { data: positions } = useGetLivePositions({
    query: { refetchInterval: 1000, queryKey: getGetLivePositionsQueryKey() },
  });

  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Init map
  useEffect(() => {
    if (mapRef.current) return;
    const map = L.map('live-map', {
      zoomControl: true,
      attributionControl: false,
    }).setView([8.5, -66.5], 6);

    // ── Capa satélite (Esri World Imagery)
    // maxNativeZoom:18 evita el "Map not available" — tiles de z18 se escalan a z19-21
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 21, maxNativeZoom: 18 }
    ).addTo(map);

    // ── Capa de calles / nombres encima del satélite (Esri Hybrid labels)
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 21, maxNativeZoom: 18, opacity: 0.9 }
    ).addTo(map);

    mapRef.current = map;
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

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
          s.marker.setLatLng([lerp(s.fromLat, s.toLat, s.progress), lerp(s.fromLng, s.toLng, s.progress)]);
        }
      }
      animRef.current = requestAnimationFrame(tick);
    }
    animRef.current = requestAnimationFrame(tick);
    return () => { running = false; if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  // Update markers
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
      const isDisc = pos.status === 'disconnected_blue' || pos.status === 'disconnected_red';
      if (isDisc && lastConn > 0 && (now - lastConn) > SEVEN_DAYS_MS) {
        hidden++;
        return;
      }

      activeIds.add(pos.id);
      const color = getStatusColor(pos.status);
      const isMoving = pos.status === 'moving';

      if (isMoving) moving++;
      else if (pos.status === 'ack') ack++;
      else if (pos.status === 'engine_idle') idle++;
      else if (isDisc) off++;

      const rows: [string, string][] = [
        ['Placa', pos.plate || '—'],
        ['Vehículo', pos.name || '—'],
        ['Estado', `<span style="color:${color};font-weight:700">${getStatusLabel(pos.status)}</span>`],
      ];
      if (pos.model) rows.push(['Modelo', pos.model]);
      if (pos.driver) rows.push(['Conductor', pos.driver]);
      if (pos.imei) rows.push(['IMEI', `<span style="font-family:monospace;font-size:11px">${pos.imei}</span>`]);
      if (pos.simNumber) rows.push(['SIM', pos.simNumber]);
      if (pos.lastConnection) rows.push(['Últ. conexión', new Date(pos.lastConnection).toLocaleString('es-VE')]);

      // Sensor rows — only show available values
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
        const hrs = Math.floor(mins / 60);
        const stopStr = hrs > 0 ? `${hrs}h ${mins % 60}m parado` : `${mins}m parado`;
        sensorRows.push(['Tiempo det.', stopStr]);
      }
      if (pos.altitude !== null && pos.altitude !== undefined && pos.altitude > 0) {
        sensorRows.push(['Altitud', `${pos.altitude} m`]);
      }
      if (pos.heading !== null && pos.heading !== undefined) {
        const dirs = ['N','NE','E','SE','S','SO','O','NO'];
        const dir = dirs[Math.round((pos.heading ?? 0) / 45) % 8];
        sensorRows.push(['Curso', `${pos.heading}° ${dir}`]);
      }
      if (pos.engineHours) {
        sensorRows.push(['Horas Motor', `<b>${pos.engineHours}</b>`]);
      }
      if (pos.batteryLevel) {
        const bv = parseFloat(pos.batteryLevel);
        const bColor = bv >= 70 ? '#22c55e' : bv >= 30 ? '#eab308' : '#ef4444';
        sensorRows.push(['Batería', `<b style="color:${bColor}">${pos.batteryLevel}</b>`]);
      }
      if (pos.gsmSignal !== null && pos.gsmSignal !== undefined) {
        const gsm = pos.gsmSignal;
        const gsmColor = gsm >= 70 ? '#22c55e' : gsm >= 40 ? '#eab308' : '#ef4444';
        const gsmBars = gsm >= 75 ? '▂▄▆█' : gsm >= 50 ? '▂▄▆░' : gsm >= 25 ? '▂▄░░' : '▂░░░';
        const gsmWarn = gsm < 40 ? ' ⚠️' : '';
        sensorRows.push(['GSM', `<b style="color:${gsmColor}">${gsmBars} ${Math.round(gsm)}%${gsmWarn}</b>`]);
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

      const radius = isMoving ? 9 : isDisc ? 5 : 7;
      const fillOpacity = isDisc ? 0.55 : 0.92;

      if (states[pos.id]) {
        const s = states[pos.id]!;
        const cur = s.marker.getLatLng();
        if (isMoving && (Math.abs(pos.lat - s.toLat) > 0.00005 || Math.abs(pos.lng - s.toLng) > 0.00005)) {
          s.fromLat = cur.lat; s.fromLng = cur.lng;
          s.toLat = pos.lat; s.toLng = pos.lng;
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
        states[pos.id] = { marker, fromLat: pos.lat, fromLng: pos.lng, toLat: pos.lat, toLng: pos.lng, progress: 1, status: pos.status };
      }
    });

    for (const id of Object.keys(states)) {
      if (!activeIds.has(id)) { map.removeLayer(states[id]!.marker); delete states[id]; }
    }

    setCounts({ moving, ack, idle, off, total: activeIds.size, hidden });
  }, [positions]);

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <div id="live-map" className="w-full h-full z-0" />

      {/* ── Header overlay ── */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-start gap-3 pointer-events-none">
        <div className="bg-[#05111f]/90 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl px-4 py-3 pointer-events-auto flex items-center gap-3 shrink-0">
          <img src={logoUrl} alt="GPS Sistema C.A." className="h-14 w-14 object-contain drop-shadow-lg" />
          <div>
            <div className="text-[15px] font-extrabold text-white tracking-tight leading-tight">GPS SISTEMA C.A.</div>
            <div className="text-[9px] font-bold text-sky-400/80 tracking-[0.25em] uppercase mt-0.5">Centro de Monitoreo</div>
            <div className="text-[9px] text-white/40 tracking-[0.15em] uppercase mt-0.5">rastreoplus247.com</div>
          </div>
          <div className="w-px h-12 bg-white/10 mx-1" />
          <div className="text-center">
            <div className="text-[9px] font-bold text-white/40 uppercase tracking-widest mb-1">Hora Local</div>
            <div className="text-2xl font-mono font-semibold text-sky-300 tabular-nums leading-none">
              {time.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="text-[9px] text-white/30 mt-1">
              {time.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </div>

        <div className="flex gap-2 pointer-events-auto flex-wrap">
          {[
            { label: 'En Mapa', value: counts.total, color: 'text-white', bg: 'bg-[#05111f]/90', dot: null },
            { label: 'En Movimiento', value: counts.moving, color: 'text-green-400', bg: 'bg-[#052b1a]/90', dot: '#22c55e' },
            { label: 'ACK / Encendido', value: counts.ack, color: 'text-yellow-400', bg: 'bg-[#1a1500]/90', dot: '#eab308' },
            { label: 'Motor Ralentí', value: counts.idle, color: 'text-orange-400', bg: 'bg-[#1a0800]/90', dot: '#f97316' },
            { label: 'Desconectados', value: counts.off, color: 'text-blue-400', bg: 'bg-[#05112b]/90', dot: '#3b82f6' },
            { label: 'Ocultos >7d', value: counts.hidden, color: 'text-white/30', bg: 'bg-[#05111f]/80', dot: null },
          ].map(s => (
            <div key={s.label} className={`${s.bg} backdrop-blur-md border border-white/10 rounded-xl shadow-xl px-4 py-2.5 text-center min-w-[90px]`}>
              {s.dot && (
                <div className="flex items-center justify-center mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: s.dot, boxShadow: `0 0 8px ${s.dot}88` }} />
                </div>
              )}
              <div className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
              <div className="text-[9px] font-bold text-white/40 uppercase tracking-wider mt-0.5 leading-tight">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <div className="bg-[#05111f]/90 backdrop-blur-md border border-white/10 px-5 py-2 rounded-full shadow-2xl pointer-events-auto flex items-center gap-5">
          {[
            { color: '#22c55e', label: 'En Movimiento' },
            { color: '#eab308', label: 'ACK' },
            { color: '#f97316', label: 'Ralentí' },
            { color: '#3b82f6', label: 'Desconectado' },
            { color: '#ef4444', label: 'Sin Señal' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color, boxShadow: `0 0 6px ${item.color}88` }} />
              <span className="text-xs font-medium text-white/70">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Badge ── */}
      <div className="absolute bottom-5 right-3 z-10">
        <div className="bg-[#05111f]/90 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-lg text-[10px] font-bold text-white/40 uppercase tracking-wider">
          🛰 Satélite + Calles · Esri · 1s
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
