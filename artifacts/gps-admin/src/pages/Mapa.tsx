import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { useGetLivePositions, getGetLivePositionsQueryKey } from '@workspace/api-client-react';
import { getStatusColor, getStatusLabel } from '@/lib/status-colors';
import logoUrl from '/logo.png';

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
  const [counts, setCounts] = useState({ moving: 0, ack: 0, idle: 0, off: 0, total: 0 });

  const { data: positions } = useGetLivePositions({
    query: { refetchInterval: 2000, queryKey: getGetLivePositionsQueryKey() },
  });

  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Init map
  useEffect(() => {
    if (mapRef.current) return;
    const map = L.map('live-map', { zoomControl: true, attributionControl: false }).setView([8.5, -66.5], 6);

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19 }
    ).addTo(map);

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, opacity: 0.7 }
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
    const DURATION = 1800;

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
    let moving = 0, ack = 0, idle = 0, off = 0;

    positions.forEach(pos => {
      if (pos.lat === null || pos.lng === null) return;
      activeIds.add(pos.id);
      const color = getStatusColor(pos.status);
      const isMoving = pos.status === 'moving';
      const isDisc = pos.status === 'disconnected_blue' || pos.status === 'disconnected_red';

      if (isMoving) moving++;
      else if (pos.status === 'ack') ack++;
      else if (pos.status === 'engine_idle') idle++;
      else if (isDisc) off++;

      // Detailed popup HTML
      const rows: [string, string][] = [
        ['Placa', pos.plate || '—'],
        ['Nombre', pos.name || '—'],
        ['Estado', `<span style="color:${color};font-weight:700">${getStatusLabel(pos.status)}</span>`],
      ];
      if ((pos.speed ?? 0) > 0) rows.push(['Velocidad', `<b style="color:${(pos.speed ?? 0) > 90 ? '#ef4444' : '#22c55e'}">${pos.speed} km/h${(pos.speed ?? 0) > 90 ? ' ⚠️' : ''}</b>`]);
      if (pos.model) rows.push(['Modelo', pos.model]);
      if (pos.imei) rows.push(['IMEI', `<span style="font-family:monospace;font-size:11px">${pos.imei}</span>`]);
      if (pos.simNumber) rows.push(['SIM', pos.simNumber]);
      if (pos.driver) rows.push(['Conductor', pos.driver]);
      if (pos.lastConnection) rows.push(['Última conexión', pos.lastConnection]);

      const popup = `
        <div style="font-family:'Inter',sans-serif;min-width:220px;max-width:260px">
          <div style="background:${color};padding:8px 12px;border-radius:8px 8px 0 0;margin:-8px -8px 0 -8px">
            <div style="font-size:16px;font-weight:800;color:#fff;letter-spacing:0.03em">${pos.plate || pos.name}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.8);margin-top:2px">${pos.name}</div>
          </div>
          <div style="padding:8px 0 4px 0">
            ${rows.map(([k, v]) => `
              <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:3px 0;border-bottom:1px solid #f1f5f9">
                <span style="font-size:11px;color:#94a3b8;font-weight:600;white-space:nowrap;margin-right:8px">${k}</span>
                <span style="font-size:12px;color:#1e293b;text-align:right">${v}</span>
              </div>`).join('')}
          </div>
          ${pos.lat && pos.lng ? `
          <a href="https://maps.google.com/?q=${pos.lat},${pos.lng}" target="_blank"
             style="display:block;text-align:center;margin-top:6px;padding:5px;background:#f8fafc;border-radius:6px;font-size:11px;color:#3b82f6;text-decoration:none;font-weight:600;border:1px solid #e2e8f0">
            📍 Ver en Google Maps
          </a>` : ''}
        </div>
      `;

      const radius = isMoving ? 9 : isDisc ? 5 : 7;
      const fillOpacity = isDisc ? 0.5 : 0.92;

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
          radius, fillColor: color, color, weight: 2.5, opacity: 1, fillOpacity,
        }).bindPopup(popup, { maxWidth: 280, className: 'gps-popup' });
        marker.addTo(map);
        states[pos.id] = { marker, fromLat: pos.lat, fromLng: pos.lng, toLat: pos.lat, toLng: pos.lng, progress: 1, status: pos.status };
      }
    });

    // Remove stale
    for (const id of Object.keys(states)) {
      if (!activeIds.has(id)) { map.removeLayer(states[id]!.marker); delete states[id]; }
    }

    setCounts({ moving, ack, idle, off, total: positions.length });
  }, [positions]);

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <div id="live-map" className="w-full h-full z-0" />

      {/* ── Header overlay ── */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-start gap-3 pointer-events-none">

        {/* Brand card */}
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

        {/* Stats cards */}
        <div className="flex gap-2 pointer-events-auto flex-wrap">
          {[
            { label: 'Total Flota', value: counts.total, color: 'text-white', bg: 'bg-[#05111f]/90', dot: null },
            { label: 'En Movimiento', value: counts.moving, color: 'text-green-400', bg: 'bg-[#052b1a]/90', dot: '#22c55e' },
            { label: 'ACK / Encendido', value: counts.ack, color: 'text-yellow-400', bg: 'bg-[#1a1500]/90', dot: '#eab308' },
            { label: 'Motor Ralentí', value: counts.idle, color: 'text-orange-400', bg: 'bg-[#1a0800]/90', dot: '#f97316' },
            { label: 'Desconectados', value: counts.off, color: 'text-blue-400', bg: 'bg-[#05112b]/90', dot: '#3b82f6' },
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

      {/* ── Satellite badge ── */}
      <div className="absolute bottom-5 right-3 z-10">
        <div className="bg-[#05111f]/90 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-lg text-[10px] font-bold text-white/40 uppercase tracking-wider">
          🛰 Satellite · Esri
        </div>
      </div>

      {/* Popup styles */}
      <style>{`
        .gps-popup .leaflet-popup-content-wrapper {
          border-radius: 12px;
          padding: 8px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
          border: 1px solid #e2e8f0;
        }
        .gps-popup .leaflet-popup-content { margin: 0; }
        .gps-popup .leaflet-popup-tip { background: #fff; }
      `}</style>
    </div>
  );
}
