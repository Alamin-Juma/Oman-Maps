/**
 * River tracing on elevation data (ADR-0009 section 3, option B).
 *
 * The idea, in plain words: flood the land from the sea upward. Whenever the rising water
 * reaches a new cell, remember which already-wet neighbour it came from. That gives every
 * cell a "this way down to the sea" pointer that climbs out of hollows the way real water
 * fills and spills them. Following the pointers from the river's source gives its course.
 *
 * Two things keep the result honest:
 * - a corridor: only land near the surveyed guide line (or, without one, near the teacher's
 *   rough line) can carry the river, so it cannot wander into another river's valley;
 * - a gentle pull toward the guide in flat land, where elevation alone cannot say where
 *   the channel is.
 *
 * Pure: grids and lines in, a line out. No pack, feature or place is named here.
 */
import { KM_PER_DEG_LAT, boundsOfPoints, expandBounds, haversineKm, kmPerDegLon, type LonLat } from "./geo-math.js";
import { cellOf, contains, cropGrid, lonLatOfCell, oceanMask, type GeoGrid } from "./grid.js";
import { findFlatRegion, simplifyLine } from "./lakes.js";

export interface TraceOptions {
  /** Half-width of the corridor around the guide line, km. */
  guidedCorridorKm?: number;
  /** Half-width of the corridor around the rough line when there is no guide, km. */
  unguidedCorridorKm?: number;
  /** The river starts on the biggest stream within this distance of the rough line's first point, km. */
  snapKm?: number;
  /** In flat land, prefer cells near the guide: metres of "virtual height" per km away from it. */
  guidePullMetresPerKm?: number;
  /** Elevation at or below which a cell is open sea, metres. */
  seaLevel?: number;
  /** Detail kept in the output line, metres. */
  simplifyMetres?: number;
  /** Surveyed lines are often drawn in pieces (broken at lakes and dams). Gaps up to this long are bridged, km. */
  maxGuideGapKm?: number;
}

/** [lon, lat, elevationMetres, distanceKm, widthHint 0..1] */
export type RiverPoint = [number, number, number, number, number];

export interface TracedRiver {
  points: RiverPoint[];
  lengthKm: number;
  endsIn: "sea" | "lake";
  guided: boolean;
  maxOffGuideKm: number | null;
}

export interface TraceInput {
  dem: GeoGrid;
  /** The pack's rough line, source end first. */
  roughPath: readonly LonLat[];
  /** Surveyed lines near the river (may be empty). */
  guides: readonly (readonly LonLat[])[];
  options?: TraceOptions;
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function traceRiver({ dem: fullDem, roughPath, guides, options = {} }: TraceInput): TracedRiver {
  if (roughPath.length < 2) throw new Error("traceRiver: the rough line needs at least two points");
  const usableGuides = bridgeGuides(guides.filter((g) => g.length >= 2), options.maxGuideGapKm ?? 120);
  const guided = usableGuides.length > 0;
  const corridorKm = guided ? (options.guidedCorridorKm ?? 20) : (options.unguidedCorridorKm ?? 40);
  const snapKm = options.snapKm ?? 8;
  const pull = options.guidePullMetresPerKm ?? 0.5;
  const seaLevel = options.seaLevel ?? 0.01;
  const simplifyKm = (options.simplifyMetres ?? 120) / 1000;

  const start = roughPath[0]!;
  const end = roughPath.at(-1)!;
  const reference: readonly (readonly LonLat[])[] = guided ? usableGuides : [roughPath];

  // Work on the part of the data around the river only.
  const everything = boundsOfPoints([...reference.flat(), ...roughPath]);
  const marginDeg = (corridorKm + snapKm + 5) / (KM_PER_DEG_LAT * Math.max(0.2, Math.cos((start[1] * Math.PI) / 180)));
  const dem = cropGrid(fullDem, expandBounds(everything, marginDeg));
  const { width, height } = dem;
  const n = width * height;
  const midLat = dem.north - (height / 2) * dem.cell;
  const kmX = dem.cell * kmPerDegLon(midLat);
  const kmY = dem.cell * KM_PER_DEG_LAT;
  const stepKm = NEIGHBOURS.map(([di, dj]) => Math.hypot(di * kmX, dj * kmY));

  // 1. Distance from every cell to the reference line(s), out to the corridor width.
  const dist = distanceField(dem, reference, corridorKm, stepKm);
  const inCorridor = new Uint8Array(n);
  for (let c = 0; c < n; c++) if (dist[c]! <= corridorKm) inCorridor[c] = 1;
  // The ends of the teacher's line are always inside, even when the guide starts elsewhere.
  for (const p of [start, end]) {
    forCellsWithin(dem, p, snapKm + 2, kmX, kmY, (c) => {
      inCorridor[c] = 1;
    });
  }

  // 2. Where does the river end? A lake under the line's end, otherwise the sea.
  const outlet = new Uint8Array(n);
  let endsIn: "sea" | "lake" = "sea";
  // Sea is water at sea level that reaches the edge of the data. An inland basin below sea level is
  // walled off by land and is not an outlet; it would end the river inland (findings register CR59).
  const ocean = oceanMask(dem, seaLevel);
  let seaNearEnd = false;
  forCellsWithin(dem, end, 3, kmX, kmY, (c) => {
    if (ocean[c]) seaNearEnd = true;
  });
  const lake = seaNearEnd ? null : findFlatRegion(dem, end, 3, seaLevel, (r) => r.cells * kmX * kmY >= 5 && r.levelMetres > seaLevel + 2);
  if (lake) {
    endsIn = "lake";
    for (let c = 0; c < n; c++) {
      if (lake.mask[c]) {
        outlet[c] = 1;
        inCorridor[c] = 1;
      }
    }
  } else {
    for (let c = 0; c < n; c++) if (inCorridor[c] && ocean[c]) outlet[c] = 1;
  }

  // 3. Flood upward from the outlets, remembering the way down.
  const parent = new Int32Array(n).fill(-2); // -2 = never reached, -1 = outlet
  const order = new Int32Array(n);
  let reached = 0;
  const heap = new MinHeap();
  for (let c = 0; c < n; c++) {
    if (!outlet[c]) continue;
    const i = c % width;
    const j = (c - i) / width;
    let onShore = false;
    for (const [di, dj] of NEIGHBOURS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= width || nj >= height) continue;
      const m = nj * width + ni;
      if (inCorridor[m] && !outlet[m]) onShore = true;
    }
    parent[c] = -1;
    if (onShore) heap.push(dem.data[c]!, c);
  }
  if (heap.size === 0) {
    throw new Error(
      `traceRiver: no sea or lake to drain into within ${corridorKm} km of the river line ` +
        `(line ends at ${end[0]}, ${end[1]}). Check the line's last point and the elevation data.`,
    );
  }
  const TINY = 1e-5; // keeps flat areas draining toward the outlet instead of at random
  while (heap.size > 0) {
    const level = heap.topKey;
    const c = heap.pop();
    order[reached++] = c;
    const i = c % width;
    const j = (c - i) / width;
    for (let k = 0; k < 8; k++) {
      const ni = i + NEIGHBOURS[k]![0];
      const nj = j + NEIGHBOURS[k]![1];
      if (ni < 0 || nj < 0 || ni >= width || nj >= height) continue;
      const m = nj * width + ni;
      if (parent[m] !== -2 || !inCorridor[m]) continue;
      parent[m] = c;
      const effective = dem.data[m]! + pull * Math.min(dist[m]!, corridorKm);
      heap.push(Math.max(effective, level + TINY), m);
    }
  }

  // 4. How much land drains through each cell (cells reached later drain into earlier ones).
  const upstream = new Float32Array(n);
  for (let k = reached - 1; k >= 0; k--) {
    const c = order[k]!;
    upstream[c] = upstream[c]! + 1;
    const p = parent[c]!;
    if (p >= 0) upstream[p] = upstream[p]! + upstream[c]!;
  }

  // 5. Start on the biggest stream near the line's first point.
  let source = -1;
  let sourceFlow = 0;
  forCellsWithin(dem, start, snapKm, kmX, kmY, (c) => {
    if (parent[c]! >= 0 && upstream[c]! > sourceFlow) {
      sourceFlow = upstream[c]!;
      source = c;
    }
  });
  if (source < 0) {
    throw new Error(`traceRiver: the river's start (${start[0]}, ${start[1]}) does not drain to the outlet; no sea or lake is reachable from it.`);
  }

  // 6. Follow the way down.
  const cells: number[] = [];
  for (let c = source; c >= 0; c = parent[c]!) {
    cells.push(c);
    if (outlet[c]) break;
  }

  // 7. Tidy up: smooth the staircase, drop needless points, make sure water never runs uphill.
  const raw = cells.map((c): LonLat => lonLatOfCell(dem, c % width, Math.floor(c / width)));
  const smooth = smoothLine(raw, 2);
  const flat = smooth.map(([lon, lat], idx) => [(lon - dem.west) * (kmX / dem.cell), (dem.north - lat) * (kmY / dem.cell), idx] as const);
  const kept = simplifyLine(flat, simplifyKm).map((p) => p[2]);

  // The water surface along the river, filled from the mouth upward: it meets the lake (or the sea)
  // at its level and never rises downstream; a hollow on the way fills to its sill, as standing
  // water does. A running minimum from the source instead lowered the mouth to the deepest hollow
  // (findings register CR61).
  const mouthLevel = endsIn === "lake" && lake ? lake.levelMetres : seaLevel;
  const elevationAt = new Array<number>(cells.length);
  for (let k = cells.length - 1; k >= 0; k--) {
    const ground = Math.max(0, dem.data[cells[k]!]!);
    elevationAt[k] = k === cells.length - 1 ? Math.max(0, mouthLevel) : Math.max(ground, elevationAt[k + 1]!);
  }
  const maxFlow = upstream[cells.at(-1)!]! || 1;
  const points: RiverPoint[] = [];
  let distanceKm = 0;
  let offGuide = 0;
  // Drop points too close to the last point KEPT (they would not survive rounding to 10 m), but
  // always keep both ends: without its outlet a short river collapses to one point, which
  // carveChannel ignores (findings register CR60).
  const chosen: number[] = [];
  for (const idx of kept) {
    if (chosen.length === 0 || haversineKm(smooth[chosen.at(-1)!]!, smooth[idx]!) >= 0.011) chosen.push(idx);
  }
  const outletIdx = kept.at(-1)!;
  if (chosen.at(-1) !== outletIdx) {
    if (chosen.length > 1) chosen[chosen.length - 1] = outletIdx; // replace the point nearest the mouth
    else chosen.push(outletIdx);
  }
  for (let k = 0; k < chosen.length; k++) {
    const idx = chosen[k]!;
    if (k > 0) distanceKm += haversineKm(smooth[chosen[k - 1]!]!, smooth[idx]!);
    const p = smooth[idx]!;
    points.push([round(p[0], 5), round(p[1], 5), round(elevationAt[idx]!, 1), round(distanceKm, 2), round(Math.sqrt(upstream[cells[idx]!]! / maxFlow), 3)]);
  }
  for (const c of cells) offGuide = Math.max(offGuide, dist[c]!);

  return {
    points,
    lengthKm: round(distanceKm, 1),
    endsIn,
    guided,
    maxOffGuideKm: guided ? round(Math.min(offGuide, corridorKm + snapKm + 2), 1) : null,
  };
}

/**
 * Join the pieces of a surveyed river into one connected set by adding straight "bridges"
 * across the gaps (map data often breaks a river where it passes through a lake or
 * reservoir). Closest ends are joined first; a gap longer than `maxGapKm` is left open.
 * @returns the original lines plus one two-point line per bridge.
 */
export function bridgeGuides(lines: readonly (readonly LonLat[])[], maxGapKm: number): LonLat[][] {
  const out: LonLat[][] = lines.map((l) => l.map((p): LonLat => [p[0], p[1]]));
  const group = out.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i]!)));
  // Pieces that already touch belong together.
  const ends = (l: readonly LonLat[]) => [l[0]!, l.at(-1)!];
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      if (ends(lines[a]!).some((p) => ends(lines[b]!).some((q) => haversineKm(p, q) < 1))) group[find(a)] = find(b);
    }
  }
  for (;;) {
    let best: { km: number; a: number; b: number; from: LonLat; to: LonLat } | null = null;
    for (let a = 0; a < lines.length; a++) {
      for (let b = a + 1; b < lines.length; b++) {
        if (find(a) === find(b)) continue;
        for (const p of ends(lines[a]!)) {
          for (const q of ends(lines[b]!)) {
            const km = haversineKm(p, q);
            if (km <= maxGapKm && (!best || km < best.km)) best = { km, a, b, from: p, to: q };
          }
        }
      }
    }
    if (!best) return out;
    out.push([[best.from[0], best.from[1]], [best.to[0], best.to[1]]]);
    group[find(best.a)] = find(best.b);
  }
}

/** Lower the terrain along a river so the water surface is never buried under it. */
export function carveChannel(dem: GeoGrid, river: readonly RiverPoint[], radiusCells = 1): void {
  for (let k = 1; k < river.length; k++) {
    const a = river[k - 1]!;
    const b = river[k]!;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / (dem.cell / 2)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const level = a[2] + (b[2] - a[2]) * t;
      const lon = a[0] + (b[0] - a[0]) * t;
      const lat = a[1] + (b[1] - a[1]) * t;
      if (!contains(dem, lon, lat)) continue; // this part of the river is outside this piece of terrain
      const [ci, cj] = cellOf(dem, [lon, lat]);
      for (let dj = -radiusCells; dj <= radiusCells; dj++) {
        for (let di = -radiusCells; di <= radiusCells; di++) {
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= dem.width || j >= dem.height) continue;
          const c = j * dem.width + i;
          if (dem.data[c]! > level) dem.data[c] = level;
        }
      }
    }
  }
}

// ---- helpers ----

/** Shortest distance (km) from each cell to any of the lines, exact near the lines, capped at `maxKm`. */
function distanceField(dem: GeoGrid, lines: readonly (readonly LonLat[])[], maxKm: number, stepKm: number[]): Float32Array {
  const { width, height } = dem;
  const dist = new Float32Array(width * height).fill(Infinity);
  const heap = new MinHeap();
  for (const line of lines) {
    for (let k = 1; k < line.length; k++) {
      const a = line[k - 1]!;
      const b = line[k]!;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / (dem.cell / 2)));
      for (let s = 0; s <= steps; s++) {
        const lon = a[0] + ((b[0] - a[0]) * s) / steps;
        const lat = a[1] + ((b[1] - a[1]) * s) / steps;
        if (lon < dem.west || lat > dem.north || lon > dem.west + width * dem.cell || lat < dem.north - height * dem.cell) continue;
        const [i, j] = cellOf(dem, [lon, lat]);
        const c = j * width + i;
        if (dist[c] !== 0) {
          dist[c] = 0;
          heap.push(0, c);
        }
      }
    }
  }
  while (heap.size > 0) {
    const d = heap.topKey;
    const c = heap.pop();
    if (d > dist[c]!) continue;
    const i = c % width;
    const j = (c - i) / width;
    for (let k = 0; k < 8; k++) {
      const ni = i + NEIGHBOURS[k]![0];
      const nj = j + NEIGHBOURS[k]![1];
      if (ni < 0 || nj < 0 || ni >= width || nj >= height) continue;
      // Rounded to 32 bits BEFORE comparing, because that is how it is stored: otherwise a
      // value popped from the heap can look "worse" than its own stored copy and be skipped.
      const nd = Math.fround(d + stepKm[k]!);
      const m = nj * width + ni;
      if (nd <= maxKm + stepKm[4]! && nd < dist[m]!) {
        dist[m] = nd;
        heap.push(nd, m);
      }
    }
  }
  return dist;
}

function forCellsWithin(dem: GeoGrid, p: LonLat, radiusKm: number, kmX: number, kmY: number, visit: (cell: number) => void): void {
  const [ci, cj] = cellOf(dem, p);
  const ri = Math.ceil(radiusKm / kmX);
  const rj = Math.ceil(radiusKm / kmY);
  for (let dj = -rj; dj <= rj; dj++) {
    for (let di = -ri; di <= ri; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= dem.width || j >= dem.height) continue;
      if (Math.hypot(di * kmX, dj * kmY) <= radiusKm) visit(j * dem.width + i);
    }
  }
}

/** Moving average over `radius` neighbours each side; the two ends stay where they are. */
export function smoothLine(line: readonly LonLat[], radius: number): LonLat[] {
  return line.map((p, i): LonLat => {
    if (i === 0 || i === line.length - 1) return [p[0], p[1]];
    const r = Math.min(radius, i, line.length - 1 - i);
    let x = 0;
    let y = 0;
    for (let k = i - r; k <= i + r; k++) {
      x += line[k]![0];
      y += line[k]![1];
    }
    return [x / (2 * r + 1), y / (2 * r + 1)];
  });
}

/** A small binary min-heap of (key, id) pairs. */
export class MinHeap {
  private keys = new Float64Array(1024);
  private ids = new Int32Array(1024);
  size = 0;

  get topKey(): number {
    return this.keys[0]!;
  }

  push(key: number, id: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
      const ids = new Int32Array(this.size * 2);
      ids.set(this.ids);
      this.ids = ids;
    }
    let i = this.size++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.keys[up]! <= key) break;
      this.keys[i] = this.keys[up]!;
      this.ids[i] = this.ids[up]!;
      i = up;
    }
    this.keys[i] = key;
    this.ids[i] = id;
  }

  pop(): number {
    const top = this.ids[0]!;
    const key = this.keys[--this.size]!;
    const id = this.ids[this.size]!;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1]! < this.keys[child]!) child++;
      if (this.keys[child]! >= key) break;
      this.keys[i] = this.keys[child]!;
      this.ids[i] = this.ids[child]!;
      i = child;
    }
    this.keys[i] = key;
    this.ids[i] = id;
    return top;
  }
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

