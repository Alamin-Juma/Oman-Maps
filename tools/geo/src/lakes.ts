/**
 * Lakes from elevation data. Open water is stored as a perfectly flat surface in the
 * elevation model, so a lake is found as the flat region under (or next to) a point.
 * Pure: grids in, numbers and outlines out.
 */
import { KM_PER_DEG_LAT, kmPerDegLon, type LonLat } from "./geo-math.js";
import { cellOf, lonLatOfCell, type GeoGrid } from "./grid.js";

/** Two neighbouring water samples differ by less than this (metres). */
const FLAT_EPS = 0.02;
/** A lake's surface may step by this much between source data files (metres). */
const LEVEL_TOLERANCE = 1.5;

export interface FlatRegion {
  /** 1 for every cell of the region, same layout as the grid. */
  mask: Uint8Array;
  cells: number;
  levelMetres: number;
  touchesEdge: boolean;
}

/** A cell is "flat water" when at least two of its four neighbours are at exactly its level. */
function isFlat(dem: GeoGrid, i: number, j: number): boolean {
  const h = dem.data[j * dem.width + i]!;
  let same = 0;
  if (i > 0 && Math.abs(dem.data[j * dem.width + i - 1]! - h) <= FLAT_EPS) same++;
  if (i < dem.width - 1 && Math.abs(dem.data[j * dem.width + i + 1]! - h) <= FLAT_EPS) same++;
  if (j > 0 && Math.abs(dem.data[(j - 1) * dem.width + i]! - h) <= FLAT_EPS) same++;
  if (j < dem.height - 1 && Math.abs(dem.data[(j + 1) * dem.width + i]! - h) <= FLAT_EPS) same++;
  return same >= 2;
}

/**
 * The flat region at a point, or the nearest one within `searchKm` that `accept`s.
 * Sea (at or below `seaLevel`) is never a lake.
 *
 * Candidates are ranked by their distance in kilometres from the point, not by square rings of
 * cells (a diagonal cell on an earlier ring can be farther away, findings register CR62). A region
 * that `accept` refuses (a puddle too small to be the lake) does not end the search: the next
 * candidate outside it is tried (CR63).
 */
export function findFlatRegion(dem: GeoGrid, point: LonLat, searchKm: number, seaLevel = 0.01, accept: (region: FlatRegion) => boolean = () => true): FlatRegion | null {
  const [ci, cj] = cellOf(dem, point);
  const kmX = dem.cell * kmPerDegLon(point[1]);
  const kmY = dem.cell * KM_PER_DEG_LAT;
  const reachX = Math.max(0, Math.ceil(searchKm / kmX));
  const reachY = Math.max(0, Math.ceil(searchKm / kmY));

  const candidates: { c: number; km: number }[] = [];
  for (let dj = -reachY - 1; dj <= reachY + 1; dj++) {
    for (let di = -reachX - 1; di <= reachX + 1; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= dem.width || j >= dem.height) continue;
      // From the point itself to the candidate cell's centre, not from the point's own cell (CR102).
      const [lon, lat] = lonLatOfCell(dem, i, j);
      const km = Math.hypot((lon - point[0]) * (kmX / dem.cell), (lat - point[1]) * (kmY / dem.cell));
      if (km > searchKm + 1e-9 && !(di === 0 && dj === 0)) continue;
      candidates.push({ c: j * dem.width + i, km });
    }
  }
  candidates.sort((a, b) => a.km - b.km || a.c - b.c);

  const tried = new Uint8Array(dem.width * dem.height);
  for (const { c } of candidates) {
    if (tried[c]) continue;
    const i = c % dem.width;
    const j = (c - i) / dem.width;
    if (dem.data[c]! <= seaLevel || !isFlat(dem, i, j)) continue;
    const region = growRegion(dem, c, seaLevel);
    if (accept(region)) return region;
    // A region grows from its seed's level, so only seeds at that same level would grow the same
    // refused region; seeds at other levels may grow a different, larger one (CR103).
    for (let k = 0; k < region.mask.length; k++) if (region.mask[k] && Math.abs(dem.data[k]! - region.levelMetres) <= FLAT_EPS) tried[k] = 1;
  }
  return null;
}

/** The connected flat region around a seed cell. */
function growRegion(dem: GeoGrid, seed: number, seaLevel: number): FlatRegion {
  const level = dem.data[seed]!;
  const mask = new Uint8Array(dem.width * dem.height);
  const queue: number[] = [seed]; // grows with the lake, not with the map
  let head = 0;
  let tail = 1;
  mask[seed] = 1;
  let touchesEdge = false;
  while (head < tail) {
    const c = queue[head++]!;
    const i = c % dem.width;
    const j = (c - i) / dem.width;
    if (i === 0 || j === 0 || i === dem.width - 1 || j === dem.height - 1) touchesEdge = true;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= dem.width || nj >= dem.height) continue;
      const n = nj * dem.width + ni;
      if (mask[n]) continue;
      const h = dem.data[n]!;
      if (h <= seaLevel || Math.abs(h - level) > LEVEL_TOLERANCE || !isFlat(dem, ni, nj)) continue;
      mask[n] = 1;
      queue.push(n);
      tail++;
    }
  }
  return { mask, cells: tail, levelMetres: level, touchesEdge };
}

/**
 * The outer boundary of a mask as a closed ring of grid-corner coordinates [x, y]
 * (x to the east, y to the south, in cells). Holes (islands) are ignored.
 */
export function traceOutline(mask: Uint8Array, width: number, height: number): [number, number][] {
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < width && j < height ? mask[j * width + i]! : 0);
  const stride = width + 1;
  // Directed boundary edges, clockwise around filled cells, keyed by their start corner.
  const next = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const key = y0 * stride + x0;
    const list = next.get(key);
    if (list) list.push(y1 * stride + x1);
    else next.set(key, [y1 * stride + x1]);
  };
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (!mask[j * width + i]) continue;
      if (!at(i, j - 1)) add(i, j, i + 1, j); // top edge, eastward
      if (!at(i + 1, j)) add(i + 1, j, i + 1, j + 1); // right edge, southward
      if (!at(i, j + 1)) add(i + 1, j + 1, i, j + 1); // bottom edge, westward
      if (!at(i - 1, j)) add(i, j + 1, i, j); // left edge, northward
    }
  }

  let best: [number, number][] = [];
  let bestArea = 0;
  for (const startKey of [...next.keys()]) {
    while ((next.get(startKey)?.length ?? 0) > 0) {
      const ring: [number, number][] = [];
      let key = startKey;
      let area = 0;
      do {
        const x = key % stride;
        const y = (key - x) / stride;
        ring.push([x, y]);
        const options = next.get(key);
        if (!options || options.length === 0) break;
        const to = options.pop()!;
        area += x * Math.floor(to / stride) - (to % stride) * y; // shoelace term
        key = to;
      } while (key !== startKey);
      if (Math.abs(area) > bestArea) {
        bestArea = Math.abs(area);
        best = ring;
      }
    }
  }
  return best;
}

/** Douglas-Peucker on a closed or open line in any flat units. */
export function simplifyLine<P extends readonly number[]>(points: readonly P[], tolerance: number): P[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a] as unknown as [number, number];
    const [bx, by] = points[b] as unknown as [number, number];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstDist = tolerance;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i] as unknown as [number, number];
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export interface DetectedLake {
  surfaceMetres: number;
  areaKm2: number;
  /** Closed ring of [lon, lat]; first point repeated at the end. */
  outline: LonLat[];
  /** The lake reaches the edge of the data, so it continues beyond the map. */
  clippedByMap: boolean;
}

/** Find the lake at (or within `searchKm` of) an anchor point. */
export function detectLake(dem: GeoGrid, anchor: LonLat, searchKm = 10, minAreaKm2 = 1): DetectedLake | null {
  const cellAreaKm2 = dem.cell * KM_PER_DEG_LAT * dem.cell * kmPerDegLon(anchor[1]);
  const region = findFlatRegion(dem, anchor, searchKm, 0.01, (r) => r.cells * cellAreaKm2 >= minAreaKm2);
  if (!region) return null;
  const areaKm2 = region.cells * cellAreaKm2;

  const ring = traceOutline(region.mask, dem.width, dem.height);
  const simplified = simplifyLine(ring, 0.75); // three quarters of a cell
  const outline = simplified.map(([x, y]): LonLat => [round(dem.west + x * dem.cell, 5), round(dem.north - y * dem.cell, 5)]);
  if (outline.length && (outline[0]![0] !== outline.at(-1)![0] || outline[0]![1] !== outline.at(-1)![1])) outline.push(outline[0]!);
  return { surfaceMetres: round(region.levelMetres, 1), areaKm2: Math.round(areaKm2), outline, clippedByMap: region.touchesEdge };
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
