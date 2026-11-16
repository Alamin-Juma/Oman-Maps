/**
 * Map maths for the 3D viewer: Web Mercator tiles and a local flat frame in kilometres.
 * Pure. (The generator in tools/geo has its own copy: apps never import tools.)
 */
export type LonLat = [number, number];

export const KM_PER_DEG_LAT = 110.574;
export const kmPerDegLon = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

export const lonToTileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;

export function latToTileY(lat: number, z: number): number {
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
}

export const tileXToLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/**
 * A flat frame centred on `origin`, in kilometres: x to the east, z to the SOUTH (three.js
 * looks down -z, so north is "into the screen"), y up. Good to well under 1% across a country.
 */
export function localFrame(origin: LonLat) {
  const kx = kmPerDegLon(origin[1]);
  return {
    toLocal: ([lon, lat]: readonly [number, number]): [number, number] => [(lon - origin[0]) * kx, -(lat - origin[1]) * KM_PER_DEG_LAT],
    toLonLat: (x: number, z: number): LonLat => [origin[0] + x / kx, origin[1] - z / KM_PER_DEG_LAT],
  };
}

export function haversineKm(a: LonLat, b: LonLat): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b[1] - a[1]) / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(r(b[0] - a[0]) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}
