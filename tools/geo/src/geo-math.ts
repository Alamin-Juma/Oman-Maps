/** Map maths: distances, Web Mercator tiles, polylines. Pure. */

/** [longitude, latitude] in WGS84 degrees. */
export type LonLat = [number, number];
/** [[west, south], [east, north]] */
export type Bounds = [LonLat, LonLat];

export const KM_PER_DEG_LAT = 110.574;
const EARTH_RADIUS_KM = 6371.0088;
const EQUATOR_METRES = 40075016.686;
const rad = (deg: number) => (deg * Math.PI) / 180;

export const kmPerDegLon = (lat: number) => 111.32 * Math.cos(rad(lat));

export function haversineKm(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthKm(path: readonly LonLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineKm(path[i - 1]!, path[i]!);
  return total;
}

/** Distance from a point to a segment, in km, on a local flat projection (fine below ~500 km). */
export function distanceToSegmentKm(p: LonLat, a: LonLat, b: LonLat): number {
  const kx = kmPerDegLon(p[1]);
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * KM_PER_DEG_LAT;
  const bx = (b[0] - p[0]) * kx;
  const by = (b[1] - p[1]) * KM_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function distanceToPolylineKm(p: LonLat, line: readonly LonLat[]): number {
  if (line.length === 1) return haversineKm(p, line[0]!);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distanceToSegmentKm(p, line[i - 1]!, line[i]!));
  return best;
}

export function boundsOfPoints(points: readonly LonLat[]): Bounds {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [[w, s], [e, n]];
}

export function expandBounds(b: Bounds, deg: number): Bounds {
  return [[b[0][0] - deg, b[0][1] - deg], [b[1][0] + deg, b[1][1] + deg]];
}

export function intersectBounds(a: Bounds, b: Bounds): Bounds | null {
  const w = Math.max(a[0][0], b[0][0]);
  const s = Math.max(a[0][1], b[0][1]);
  const e = Math.min(a[1][0], b[1][0]);
  const n = Math.min(a[1][1], b[1][1]);
  return w < e && s < n ? [[w, s], [e, n]] : null;
}

/** A square of `sizeKm` centred on a point, as lon/lat bounds. */
export function squareAround(centre: LonLat, sizeKm: number): Bounds {
  const halfLat = sizeKm / 2 / KM_PER_DEG_LAT;
  const halfLon = sizeKm / 2 / kmPerDegLon(centre[1]);
  return [[centre[0] - halfLon, centre[1] - halfLat], [centre[0] + halfLon, centre[1] + halfLat]];
}

// ---- Web Mercator XYZ tiles ----

export const MAX_MERCATOR_LAT = 85.0511287798066;

/** Fractional tile column of a longitude at a zoom. */
export const lonToTileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;

/** Fractional tile row of a latitude at a zoom (row 0 is the north). */
export function latToTileY(lat: number, z: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const s = Math.sin(rad(clamped));
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
}

export const tileXToLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function tileBounds(z: number, x: number, y: number): Bounds {
  return [[tileXToLon(x, z), tileYToLat(y + 1, z)], [tileXToLon(x + 1, z), tileYToLat(y, z)]];
}

/** Every tile at zoom `z` that overlaps the bounds, row by row from the north-west. */
export function tilesForBounds(b: Bounds, z: number): { x: number; y: number }[] {
  const eps = 1e-9;
  const x0 = Math.floor(lonToTileX(b[0][0], z) + eps);
  const x1 = Math.floor(lonToTileX(b[1][0], z) - eps);
  const y0 = Math.floor(latToTileY(b[1][1], z) + eps);
  const y1 = Math.floor(latToTileY(b[0][1], z) - eps);
  const tiles: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ x, y });
  return tiles;
}

/** Ground size of one pixel of a tile image, in metres, at a latitude. */
export function tileMetresPerPixel(z: number, lat: number, imageSize: number): number {
  return (EQUATOR_METRES * Math.cos(rad(lat))) / 2 ** z / imageSize;
}

/** The deepest zoom at which the bounds are covered by at most `maxTiles` tiles. */
export function zoomForTileCount(b: Bounds, maxTiles: number, maxZoom = 12): number {
  let best = 0;
  for (let z = 0; z <= maxZoom; z++) {
    if (tilesForBounds(b, z).length <= maxTiles) best = z;
    else break;
  }
  return best;
}
