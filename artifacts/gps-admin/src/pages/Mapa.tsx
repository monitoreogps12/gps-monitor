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

    // CartoDB Voyager — calles detalladas, nombres visibles, sin límite de zoom
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      { maxZoom: 20, subdomains: 'abcd' }
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
    const DURATION = 900; // animación ajustada al intervalo de 1s

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

      // Filtrar vehículos desconectados hace más de 7 días
      const lastConn = pos.lastConnection ? new Date(pos.lastConnection).getTime() : 0;
      const isDisconnected = pos.status === 'disconnected_blue' || pos.status === 'disconnected_red';
      if (isDisconnected && lastConn > 0 && (now - lastConn) > SEVEN_DAYS_MS) {
        hidden++;
        return;
      }

      activeIds.add(pos.id);
      const color = getStatusColor(pos.status);
      const isMoving = pos.status === 'moving';
      const isDisc = isDisconnected;

      if (isMoving) moving++;
      else if (pos.status === 'ack') ack++;
      else if (pos.status === 'engine_idle') idle++;
      else if (isDisc) off++;

      // Popup HTML
      const rows: [string, string][] = [
        ['Placa', pos.plate || '—'],
        ['Vehículo', pos.name || '—'],
        ['Estado', `<span style="color:${color};font-weight:700">${getStatusLabel(pos.status)}</span>`],
      ];
      if ((pos.speed ?? 0) > 0) rows.push(['Velocidad', `<b style="color:${(pos.speed ?? 0) > 90 ? '#ef4444' : '#16a34a'}">${pos.speed} km/h${(pos.speed ?? 0) > 90 ? ' ⚠️' : ''}</b>`]);
      if (pos.model) rows.push(['Modelo', pos.model]);
      if (pos.driver) rows.push(['Conductor', pos.driver]);
      if (pos.imei) rows.push(['IMEI', `<span style="font-family:monospace;font-size:11px">${pos.imei}</span>`]);
      if (pos.simNumber) rows.push(['SIM', pos.simNumber]);
      if (pos.lastConnection) rows.push(['Últ. conexión', new Date(pos.lastConnection).toLocaleString('es-VE')]);

      const popup = `
        <div style="font-family:'Inter',sans-serif;min-width:230px;max-width:270px">
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

    // Remove stale
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

        {/* Brand card */}
        <div className="bg-white/95 backdrop-blur-md border border-gray-200/80 rounded-2xl shadow-2xl px-4 py-3 pointer-events-auto flex items-center gap-3 shrink-0">
          <img src={logoUrl} alt="GPS Sistema C.A." className="h-14 w-14 object-contain drop-shadow" />
          <div>
            <div className="text-[15px] font-extrabold text-gray-800 tracking-tight leading-tight">GPS SISTEMA C.A.</div>
            <div className="text-[9px] font-bold text-blue-600/80 tracking-[0.25em] uppercase mt-0.5">Centro de Monitoreo</div>
            <div className="text-[9px] text-gray-400 tracking-[0.15em] uppercase mt-0.5">rastreoplus247.com</div>
          </div>
          <div className="w-px h-12 bg-gray-200 mx-1" />
          <div className="text-center">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Hora Local</div>
            <div className="text-2xl font-mono font-semibold text-blue-700 tabular-nums leading-none">
              {time.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="text-[9px] text-gray-400 mt-1">
              {time.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </div>

        {/* Stats cards */}
        <div className="flex gap-2 pointer-events-auto flex-wrap">
          {[
            { label: 'En Mapa', value: counts.total, color: 'text-gray-700', bg: 'bg-white/95', dot: null },
            { label: 'En Movimiento', value: counts.moving, color: 'text-green-700', bg: 'bg-green-50/95', dot: '#16a34a' },
            { label: 'ACK / Encendido', value: counts.ack, color: 'text-yellow-700', bg: 'bg-yellow-50/95', dot: '#ca8a04' },
            { label: 'Motor Ralentí', value: counts.idle, color: 'text-orange-700', bg: 'bg-orange-50/95', dot: '#ea580c' },
            { label: 'Desconectados', value: counts.off, color: 'text-blue-700', bg: 'bg-blue-50/95', dot: '#2563eb' },
            { label: 'Ocultos >7d', value: counts.hidden, color: 'text-gray-400', bg: 'bg-gray-50/95', dot: null },
          ].map(s => (
            <div key={s.label} className={`${s.bg} backdrop-blur-md border border-gray-200/80 rounded-xl shadow-lg px-4 py-2.5 text-center min-w-[90px]`}>
              {s.dot && (
                <div className="flex items-center justify-center mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: s.dot }} />
                </div>
              )}
              <div className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-0.5 leading-tight">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <div className="bg-white/95 backdrop-blur-md border border-gray-200/80 px-5 py-2 rounded-full shadow-xl pointer-events-auto flex items-center gap-5">
          {[
            { color: '#16a34a', label: 'En Movimiento' },
            { color: '#ca8a04', label: 'ACK' },
            { color: '#ea580c', label: 'Ralentí' },
            { color: '#2563eb', label: 'Desconectado' },
            { color: '#ef4444', label: 'Sin Señal' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
              <span className="text-xs font-medium text-gray-600">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Info badge ── */}
      <div className="absolute bottom-5 right-3 z-10">
        <div className="bg-white/95 backdrop-blur-md border border-gray-200/80 px-3 py-1.5 rounded-lg text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          🗺 Calles · Tiempo Real · 1s
        </div>
      </div>

      {/* Popup styles */}
      <style>{`
        .gps-popup .leaflet-popup-content-wrapper {
          border-radius: 12px;
          padding: 8px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.18);
          border: 1px solid #e2e8f0;
        }
        .gps-popup .leaflet-popup-content { margin: 0; }
        .gps-popup .leaflet-popup-tip { background: #fff; }
      `}</style>
    </div>
  );
}
