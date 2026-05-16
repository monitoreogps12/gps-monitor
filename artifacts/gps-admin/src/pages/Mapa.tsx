import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { useGetLivePositions, getGetLivePositionsQueryKey } from '@workspace/api-client-react';
import { getStatusColor, getStatusLabel } from '@/lib/status-colors';

export function Mapa() {
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [id: string]: L.CircleMarker }>({});
  const [time, setTime] = useState(new Date());

  const { data: positions } = useGetLivePositions({
    query: {
      refetchInterval: 2000,
      queryKey: getGetLivePositionsQueryKey()
    }
  });

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map('live-map', {
        zoomControl: false,
        attributionControl: false
      }).setView([8.0, -66.0], 6);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(map);

      mapRef.current = map;
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !positions) return;

    const currentMap = mapRef.current;
    const currentMarkers = markersRef.current;
    const activeIds = new Set<string>();

    positions.forEach(pos => {
      if (pos.lat === null || pos.lng === null) return;
      
      activeIds.add(pos.id);
      const color = getStatusColor(pos.status);
      const label = getStatusLabel(pos.status);
      const speedText = pos.status === 'moving' && pos.speed ? `<br/><b>Velocidad:</b> ${pos.speed} km/h` : '';
      
      const popupContent = `
        <div style="font-family: var(--app-font-sans); color: #000; padding: 4px;">
          <h3 style="margin: 0 0 4px 0; font-size: 16px;">${pos.plate}</h3>
          <p style="margin: 0 0 4px 0; font-size: 12px; color: #666;">${pos.name}</p>
          <div style="font-size: 13px; font-weight: bold; color: ${color};">
            ${label}
            ${speedText}
          </div>
        </div>
      `;

      if (currentMarkers[pos.id]) {
        currentMarkers[pos.id].setLatLng([pos.lat, pos.lng]);
        currentMarkers[pos.id].setStyle({ color, fillColor: color });
        currentMarkers[pos.id].getPopup()?.setContent(popupContent);
      } else {
        const marker = L.circleMarker([pos.lat, pos.lng], {
          radius: 6,
          fillColor: color,
          color: color,
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8
        }).bindPopup(popupContent);
        
        marker.addTo(currentMap);
        currentMarkers[pos.id] = marker;
      }
    });

    // Clean up old markers
    Object.keys(currentMarkers).forEach(id => {
      if (!activeIds.has(id)) {
        currentMap.removeLayer(currentMarkers[id]);
        delete currentMarkers[id];
      }
    });

  }, [positions]);

  const movingCount = positions?.filter(p => p.status === 'moving').length || 0;
  const totalCount = positions?.length || 0;

  return (
    <div className="relative w-full h-screen bg-[#1a1a1a]">
      <div id="live-map" className="w-full h-full z-0" />
      
      {/* Smart TV Overlay - Header */}
      <div className="absolute top-6 left-6 right-6 z-10 flex justify-between items-start pointer-events-none">
        <div className="bg-black/80 backdrop-blur-md border border-white/10 p-4 rounded-xl shadow-2xl pointer-events-auto flex items-center gap-6">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">GPS SISTEMA C.A.</h1>
            <div className="text-sm font-medium text-white/60 tracking-widest uppercase mt-1">
              Monitoreo en Tiempo Real
            </div>
          </div>
          <div className="h-12 w-px bg-white/10" />
          <div className="text-4xl font-mono font-light text-cyan-400">
            {time.toLocaleTimeString('es-VE')}
          </div>
        </div>

        <div className="bg-black/80 backdrop-blur-md border border-white/10 p-4 rounded-xl shadow-2xl pointer-events-auto flex gap-6">
          <div className="text-center">
            <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">Total Flota</div>
            <div className="text-4xl font-bold text-white">{totalCount}</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-semibold text-green-500/70 uppercase tracking-wider mb-1">En Movimiento</div>
            <div className="text-4xl font-bold text-green-500">{movingCount}</div>
          </div>
        </div>
      </div>

      {/* Smart TV Overlay - Legend */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <div className="bg-black/80 backdrop-blur-md border border-white/10 px-6 py-3 rounded-full shadow-2xl pointer-events-auto flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#22c55e] shadow-[0_0_10px_#22c55e]" />
            <span className="text-sm font-medium text-white">Movimiento</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#eab308] shadow-[0_0_10px_#eab308]" />
            <span className="text-sm font-medium text-white">ACK</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#f97316] shadow-[0_0_10px_#f97316]" />
            <span className="text-sm font-medium text-white">Ralentí</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#3b82f6] shadow-[0_0_10px_#3b82f6]" />
            <span className="text-sm font-medium text-white">Desc.</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#ef4444] shadow-[0_0_10px_#ef4444]" />
            <span className="text-sm font-medium text-white">Sin Señal</span>
          </div>
        </div>
      </div>
    </div>
  );
}
