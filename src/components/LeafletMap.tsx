import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CITY_CENTER } from '../lib/geo';
import type { Issue } from '../lib/types';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: 'pothole' | 'streetlight' | 'worker' | 'pin';
  status?: string;
  label: string;
  sublabel?: string;
  popupHtml?: string;
  onClick?: () => void;
}

const FALLBACK_ICON = L.icon({ iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png', shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41] });
void FALLBACK_ICON; // kept for reference; custom divIcons are used throughout

function pinHtml(kind: MapMarker['kind'], status?: string): string {
  const palette: Record<string, { bg: string; ring: string }> = {
    pothole: { bg: '#b4530a', ring: '#fbd9a8' },
    streetlight: { bg: '#1d4ed8', ring: '#bcd3fd' },
    worker: { bg: '#065f46', ring: '#a7f3d0' },
    pin: { bg: '#0c1a33', ring: '#f2b33d' },
  };
  const p = palette[kind];
  const verified = status === 'VERIFIED';
  const color = verified ? '#059669' : p.bg;
  const glyph = kind === 'pothole'
    ? '<path d="M9 17h6M10.5 13.5h3M8 10c1.5-1.4 6.5-1.4 8 0" stroke="#fff" stroke-width="1.7" stroke-linecap="round" fill="none"/>'
    : kind === 'streetlight'
      ? '<path d="M12 5v5M8.5 13.5h7" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15.5" r="1.6" fill="#ffd66b"/>'
      : kind === 'worker'
        ? '<circle cx="12" cy="10" r="2.6" fill="#fff"/><path d="M6.5 18c1.6-3 4-4 5.5-4s3.9 1 5.5 4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
        : '<circle cx="12" cy="12" r="4" fill="#f2b33d"/>';
  return `<div style="width:30px;height:38px;filter:drop-shadow(0 3px 3px rgba(0,0,0,.35))">
    <svg viewBox="0 0 24 30" width="30" height="38"><path d="M12 29S4 19.5 4 11.5A8 8 0 0 1 20 11.5C20 19.5 12 29 12 29Z" fill="${color}" stroke="${p.ring}" stroke-width="1.6"/>${glyph}</svg>
  </div>`;
}

const statusHex: Record<string, string> = {
  REPORTED: '#475569', UNDER_REVIEW: '#d97706', ASSIGNED: '#2563eb', IN_PROGRESS: '#0891b2',
  PENDING_VERIFICATION: '#7c3aed', VERIFIED: '#059669', REWORK_REQUIRED: '#ea580c', REJECTED: '#e11d48', DUPLICATE: '#6b7280', CANCELLED: '#6b7280',
};

export function issueToMarker(issue: Issue, onClick?: () => void): MapMarker {
  return {
    id: issue.id,
    lat: issue.lat,
    lng: issue.lng,
    kind: issue.category,
    status: issue.status,
    label: issue.ticketNo,
    sublabel: `${issue.category === 'pothole' ? 'Pothole' : 'Streetlight'} · ${issue.status.replace('_', ' ')}`,
    onClick,
  };
}

interface Props {
  markers: MapMarker[];
  height?: number | string;
  center?: [number, number];
  zoom?: number;
  selectable?: boolean;            // click-to-pick a location
  selected?: [number, number] | null;
  onSelect?: (lat: number, lng: number) => void;
  className?: string;
  fitToMarkers?: boolean;
}

export default function LeafletMap({ markers, height = 320, center, zoom = 13, selectable, selected, onSelect, className = '', fitToMarkers }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const selectMarker = useRef<L.Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const centerProp = center ?? CITY_CENTER;
  const markersKey = useMemo(() => markers.map(m => `${m.id}:${m.lat},${m.lng}:${m.status ?? ''}`).join('|'), [markers]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: true }).setView(centerProp, zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    markersLayer.current = L.layerGroup().addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (selectable) onSelectRef.current?.(e.latlng.lat, e.latlng.lng);
    });
    mapRef.current = map;
    const t = window.setTimeout(() => map.invalidateSize(), 120);
    return () => { window.clearTimeout(t); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync markers
  useEffect(() => {
    const map = mapRef.current, layer = markersLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const m of markers) {
      const icon = L.divIcon({ className: 'cx-pin', html: pinHtml(m.kind, m.status), iconSize: [30, 38], iconAnchor: [15, 37] });
      const marker = L.marker([m.lat, m.lng], { icon, title: m.label });
      const statusColor = m.status ? statusHex[m.status] ?? '#475569' : '#0c1a33';
      marker.bindPopup(
        `<div style="min-width:150px"><div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;color:#0c1a33">${m.label}</div>` +
        (m.sublabel ? `<div style="font-size:11px;color:#475569;margin-top:2px">${m.sublabel}</div>` : '') +
        (m.status ? `<div style="margin-top:4px;display:inline-block;font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#fff;background:${statusColor};border-radius:999px;padding:2px 8px">${m.status.replace(/_/g, ' ')}</div>` : '') +
        `</div>`
      );
      if (m.onClick) marker.on('click', () => m.onClick?.());
      marker.addTo(layer);
    }
    if (fitToMarkers && markers.length > 0) {
      const bounds = L.latLngBounds(markers.map(m => [m.lat, m.lng] as [number, number]));
      map.fitBounds(bounds.pad(0.25), { maxZoom: 15 });
    } else if (center) {
      map.setView(center, map.getZoom());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markersKey, fitToMarkers, center]);

  // Selection pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (selectMarker.current) { selectMarker.current.remove(); selectMarker.current = null; }
    if (selected) {
      const icon = L.divIcon({ className: 'cx-pin', html: pinHtml('pin'), iconSize: [30, 38], iconAnchor: [15, 37] });
      selectMarker.current = L.marker(selected, { icon, zIndexOffset: 1000 }).addTo(map);
      map.panTo(selected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.[0], selected?.[1]]);

  return (
    <div className={`relative overflow-hidden rounded-2xl ring-1 ring-slate-900/10 ${className}`} style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />
      {selectable && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-navy-900/90 px-3 py-1 text-[10px] font-semibold text-white shadow">Tap the map to drop a pin</div>
      )}
    </div>
  );
}
