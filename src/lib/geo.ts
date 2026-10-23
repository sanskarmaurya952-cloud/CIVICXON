// Geographic helpers — haversine distance + zone resolution.
// Mirrors the PostGIS ST_Distance / ST_DWithin logic used by the backend.

import type { Zone } from './types';

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/** Resolve the zone an issue falls into: nearest zone centre, must be within radiusKm. */
export function resolveZone(lat: number, lng: number, zones: Zone[]): string {
  let best: { name: string; d: number; ok: boolean } | null = null;
  for (const z of zones) {
    const d = haversineKm(lat, lng, z.lat, z.lng);
    if (d <= z.radiusKm) {
      if (!best || d < best.d) best = { name: z.name, d, ok: true };
    }
  }
  if (best) return best.name;
  // Fall back to nearest zone centre even if outside radius
  let nearest = zones[0];
  let nd = Infinity;
  for (const z of zones) {
    const d = haversineKm(lat, lng, z.lat, z.lng);
    if (d < nd) { nd = d; nearest = z; }
  }
  return nearest.name;
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export const CITY_CENTER: [number, number] = [12.9716, 77.5946]; // Bengaluru (demo service area)
