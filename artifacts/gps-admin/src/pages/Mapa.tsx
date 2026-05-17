import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { useGetLivePositions, getGetLivePositionsQueryKey } from '@workspace/api-client-react';
import { getStatusColor, getStatusLabel } from '@/lib/status-colors';

// Smooth interpolation between two coordinates
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// Animated marker state
interface MarkerState {
  marker: L.CircleMarker;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  progress: number; // 0..1
  status: string;
  plate: string;
  name: string;
  speed: number | null;
}

export function Mapa() {
  const mapRef = useRef<L.Map | null>(null);
  const markerStatesRef = useRef<Record<string, MarkerState>>({});
  const animFrameRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(Date.now());
  const [time, setTime] = useState(new Date());
  const [counts, setCounts] = useState({ moving: 0, ack: 0, idle: 0, off: 0, total: 0 });

  const { data: positions } = useGetLivePositions({
    query: {
      refetchInterval: 3000,
      queryKey: getGetLivePositionsQueryKey(),
    },
  });

  // Clock
  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Init map once
  useEffect(() => {
    if (mapRef.current) return;

    const map = L.map('live-map', {
      zoomControl: true,
      attributionControl: false,
    }).setView([8.0, -66.0], 6);

    // Satellite layer — Esri World Imagery (free, no key required)
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Esri' }
    ).addTo(map);

    // Labels overlay on top of satellite
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, opacity: 0.7 }
    ).addTo(map);

    mapRef.current = map;

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Animation loop
  useEffect(() => {
    let running = true;
    let lastTime = performance.now();

    const ANIM_DURATION_MS = 2800; // match approx refetch interval

    function animate(now: number) {
      if (!running) return;
      const dt = now - lastTime;
      lastTime = now;

      const states = markerStatesRef.current;
      for (const id in states) {
        const s = states[id]!;
        if (s.status === 'moving' && s.progress < 1) {
          s.progress = Math.min(1, s.progress + dt / ANIM_DURATION_MS);
          const lat = lerp(s.fromLat, s.toLat, s.progress);
          const lng = lerp(s.fromLng, s.toLng, s.progress);
          s.marker.setLatLng([lat, lng]);
        }
      }

      animFrameRef.current = requestAnimationFrame(animate);
    }

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Update markers when positions arrive
  useEffect(() => {
    if (!mapRef.current || !positions) return;

    const map = mapRef.current;
    const states = markerStatesRef.current;
    const activeIds = new Set<string>();

    let moving = 0, ack = 0, idle = 0, off = 0;

    positions.forEach((pos) => {
      if (pos.lat === null || pos.lng === null) return;
      activeIds.add(pos.id);

      const color = getStatusColor(pos.status);
      const label = getStatusLabel(pos.status);
      const isMoving = pos.status === 'moving';
      const isDisconnected = pos.status === 'disconnected_blue' || pos.status === 'disconnected_red';

      if (pos.status === 'moving') moving++;
      else if (pos.status === 'ack') ack++;
      else if (pos.status === 'engine_idle') idle++;
      else if (isDisconnected) off++;

      const speedText = isMoving && pos.speed ? `<br/><b>Velocidad:</b> ${pos.speed} km/h` : '';
      const popupContent = `
        <div style="font-family: Inter, sans-serif; padding: 6px; min-width: 160px;">
          <div style="font-size: 15px; font-weight: 700; color: #1e293b; margin-bottom: 4px;">${pos.plate || '—'}</div>
          <div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">${pos.name}</div>
          <div style="font-size: 12px; font-weight: 600; color: ${color}; display: flex; align-items: center; gap: 4px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;"></span>
            ${label}${speedText}
          </div>
        </div>
      `;

      // Pulse for moving vehicles
      const radius = isMoving ? 8 : isDisconnected ? 5 : 6;
      const weight = isMoving ? 2.5 : 1.5;
      const opacity = isDisconnected ? 0.5 : 0.9;

      if (states[pos.id]) {
        const s = states[pos.id]!;
        const curLatLng = s.marker.getLatLng();
        const movedEnough = Math.abs(pos.lat - s.toLat) > 0.00005 || Math.abs(pos.lng - s.toLng) > 0.00005;

        if (movedEnough && isMoving) {
          s.fromLat = curLatLng.lat;
          s.fromLng = curLatLng.lng;
          s.toLat = pos.lat;
          s.toLng = pos.lng;
          s.progress = 0;
        } else if (!isMoving) {
          s.marker.setLatLng([pos.lat, pos.lng]);
          s.toLat = pos.lat;
          s.toLng = pos.lng;
        }

        if (s.status !== pos.status) {
          s.marker.setStyle({ color, fillColor: color, radius, weight, fillOpacity: opacity });
          s.status = pos.status;
        }
        s.marker.getPopup()?.setContent(popupContent);
      } else {
        const marker = L.circleMarker([pos.lat, pos.lng], {
          radius,
          fillColor: color,
          color,
          weight,
          opacity: 1,
          fillOpacity: opacity,
        }).bindPopup(popupContent, { maxWidth: 220 });

        marker.addTo(map);

        states[pos.id] = {
          marker,
          fromLat: pos.lat,
          fromLng: pos.lng,
          toLat: pos.lat,
          toLng: pos.lng,
          progress: 1,
          status: pos.status,
          plate: pos.plate,
          name: pos.name,
          speed: pos.speed ?? null,
        };
      }
    });

    // Remove stale markers
    for (const id of Object.keys(states)) {
      if (!activeIds.has(id)) {
        map.removeLayer(states[id]!.marker);
        delete states[id];
      }
    }

    setCounts({ moving, ack, idle, off, total: positions.length });
    lastUpdateRef.current = Date.now();
  }, [positions]);

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <div id="live-map" className="w-full h-full z-0" />

      {/* Header overlay */}
      <div className="absolute top-4 left-4 right-4 z-10 flex justify-between items-start gap-3 pointer-events-none">
        {/* Brand + clock */}
        <div className="bg-[#0f1c2e]/90 backdrop-blur-md border border-white/10 px-5 py-3 rounded-xl shadow-2xl pointer-events-auto flex items-center gap-5">
          <div>
            <div className="text-xl font-bold text-white tracking-tight leading-none">GPS SISTEMA C.A.</div>
            <div className="text-[10px] font-semibold text-sky-400/80 tracking-[0.2em] uppercase mt-0.5">Monitoreo · Tiempo Real</div>
          </div>
          <div className="w-px h-10 bg-white/10" />
          <div className="text-3xl font-mono font-light text-sky-300 tabular-nums">
            {time.toLocaleTimeString('es-VE')}
          </div>
        </div>

        {/* Stats panel */}
        <div className="bg-[#0f1c2e]/90 backdrop-blur-md border border-white/10 px-5 py-3 rounded-xl shadow-2xl pointer-events-auto flex items-center gap-5">
          {[
            { label: 'Total', value: counts.total, color: 'text-white' },
            { label: 'Movimiento', value: counts.moving, color: 'text-green-400', dot: '#22c55e' },
            { label: 'ACK', value: counts.ack, color: 'text-yellow-400', dot: '#eab308' },
            { label: 'Ralentí', value: counts.idle, color: 'text-orange-400', dot: '#f97316' },
            { label: 'Desc.', value: counts.off, color: 'text-blue-400', dot: '#3b82f6' },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="flex items-center justify-center gap-1.5 mb-0.5">
                {s.dot && <span className="w-2 h-2 rounded-full inline-block" style={{ background: s.dot, boxShadow: `0 0 6px ${s.dot}` }} />}
                <div className="text-[10px] font-semibold text-white/50 uppercase tracking-wider">{s.label}</div>
              </div>
              <div className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend bar */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <div className="bg-[#0f1c2e]/90 backdrop-blur-md border border-white/10 px-6 py-2.5 rounded-full shadow-2xl pointer-events-auto flex items-center gap-5">
          {[
            { color: '#22c55e', label: 'En Movimiento' },
            { color: '#eab308', label: 'ACK' },
            { color: '#f97316', label: 'Ralentí' },
            { color: '#3b82f6', label: 'Desconectado' },
            { color: '#ef4444', label: 'Sin Señal' },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: item.color, boxShadow: `0 0 8px ${item.color}88` }}
              />
              <span className="text-xs font-medium text-white/80">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Satellite badge */}
      <div className="absolute bottom-5 right-4 z-10">
        <div className="bg-[#0f1c2e]/90 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-lg text-[10px] font-semibold text-white/50 uppercase tracking-wider">
          🛰️ Vista Satelital
        </div>
      </div>
    </div>
  );
}
