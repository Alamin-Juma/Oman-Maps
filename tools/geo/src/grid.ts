/**
 * A raster on a plain longitude/latitude grid (square cells in degrees), north up.
 * Cell (i, j) covers lon [west + i*cell, west + (i+1)*cell] and lat [north - (j+1)*cell, north - j*cell].
 * Pure: no I/O.
 */
import type { Bounds, LonLat } from "./geo-math.js";

export type GridData = Float32Array | Uint8Array;

export interface GeoGrid<T extends GridData = Float32Array> {
  width: number;
  height: number;
  west: number;
  north: number;
  /** Cell size in degrees. */
  cell: number;
  data: T;
}

export function makeGrid(bounds: Bounds, cell: number): GeoGrid {
  const width = Math.max(1, Math.round((bounds[1][0] - bounds[0][0]) / cell));
  const height = Math.max(1, Math.round((bounds[1][1] - bounds[0][1]) / cell));
  return { width, height, west: bounds[0][0], north: bounds[1][1], cell, data: new Float32Array(width * height) };
}

export function gridBounds(g: GeoGrid<GridData>): Bounds {
  return [[g.west, g.north - g.height * g.cell], [g.west + g.width * g.cell, g.north]];
}

/** Fill a grid by evaluating a function at every cell centre. */
export function gridFromFunction(bounds: Bounds, cell: number, fn: (lon: number, lat: number) => number): GeoGrid {
  const g = makeGrid(bounds, cell);
  for (let j = 0; j < g.height; j++) {
    const lat = g.north - (j + 0.5) * cell;
    for (let i = 0; i < g.width; i++) g.data[j * g.width + i] = fn(g.west + (i + 0.5) * cell, lat);
  }
  return g;
}

export function lonLatOfCell(g: GeoGrid<GridData>, i: number, j: number): LonLat {
  return [g.west + (i + 0.5) * g.cell, g.north - (j + 0.5) * g.cell];
}

/** The cell containing a point, clamped to the grid. */
export function cellOf(g: GeoGrid<GridData>, p: LonLat): [number, number] {
  const i = Math.max(0, Math.min(g.width - 1, Math.floor((p[0] - g.west) / g.cell)));
  const j = Math.max(0, Math.min(g.height - 1, Math.floor((g.north - p[1]) / g.cell)));
  return [i, j];
}

export function contains(g: GeoGrid<GridData>, lon: number, lat: number): boolean {
  return lon >= g.west && lon <= g.west + g.width * g.cell && lat <= g.north && lat >= g.north - g.height * g.cell;
}

/** Bilinear sample at a point; coordinates outside the grid are clamped to its edge. */
export function sample(g: GeoGrid<GridData>, lon: number, lat: number): number {
  const fx = Math.max(0, Math.min(g.width - 1, (lon - g.west) / g.cell - 0.5));
  const fy = Math.max(0, Math.min(g.height - 1, (g.north - lat) / g.cell - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(g.width - 1, x0 + 1);
  const y1 = Math.min(g.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const d = g.data;
  const top = d[y0 * g.width + x0]! * (1 - tx) + d[y0 * g.width + x1]! * tx;
  const bottom = d[y1 * g.width + x0]! * (1 - tx) + d[y1 * g.width + x1]! * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * Half-resolution copy: each cell is the mean of a 2 x 2 block. An odd width or height rounds UP,
 * and the edge blocks average only the cells that exist, so the last row and column are kept
 * (findings register CR68: they were dropped, and with them any land that was only there).
 */
export function halve<T extends GridData>(g: GeoGrid<T>): GeoGrid<T> {
  const width = Math.max(1, Math.ceil(g.width / 2));
  const height = Math.max(1, Math.ceil(g.height / 2));
  const data = new (g.data.constructor as new (n: number) => T)(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let sum = 0;
      let count = 0;
      for (let dj = 0; dj < 2; dj++) {
        const sj = j * 2 + dj;
        if (sj >= g.height) continue;
        for (let di = 0; di < 2; di++) {
          const si = i * 2 + di;
          if (si >= g.width) continue;
          sum += g.data[sj * g.width + si]!;
          count++;
        }
      }
      data[j * width + i] = sum / count;
    }
  }
  return { width, height, west: g.west, north: g.north, cell: g.cell * 2, data };
}

/** The grid plus coarser copies (each half the one before), finest first. */
export function mipChain<T extends GridData>(g: GeoGrid<T>, minSize = 32): GeoGrid<T>[] {
  const chain = [g];
  while (Math.min(chain.at(-1)!.width, chain.at(-1)!.height) >= minSize * 2) chain.push(halve(chain.at(-1)!));
  return chain;
}

/**
 * Sample from the level of a mip chain that matches the wanted cell size, so that shrinking
 * an image averages the data instead of skipping it (no speckle).
 */
export function pickLevel<T extends GridData>(chain: readonly GeoGrid<T>[], targetCellDeg: number): GeoGrid<T> {
  let level = chain[0]!;
  for (const candidate of chain) {
    if (candidate.cell <= targetCellDeg * 1.01) level = candidate;
    else break;
  }
  return level;
}

/** A copy of the part of the grid inside the bounds (snapped to whole cells). */
export function cropGrid(g: GeoGrid, bounds: Bounds): GeoGrid {
  const i0 = Math.max(0, Math.floor((bounds[0][0] - g.west) / g.cell));
  const i1 = Math.min(g.width, Math.ceil((bounds[1][0] - g.west) / g.cell));
  const j0 = Math.max(0, Math.floor((g.north - bounds[1][1]) / g.cell));
  const j1 = Math.min(g.height, Math.ceil((g.north - bounds[0][1]) / g.cell));
  // Bounds outside the grid used to become a one-cell crop of the wrong place (findings register CR69).
  if (i1 <= i0 || j1 <= j0) throw new Error(`cropGrid: the bounds ${JSON.stringify(bounds)} do not overlap the grid`);
  const width = i1 - i0;
  const height = j1 - j0;
  const data = new Float32Array(width * height);
  for (let j = 0; j < height; j++) data.set(g.data.subarray((j0 + j) * g.width + i0, (j0 + j) * g.width + i0 + width), j * width);
  return { width, height, west: g.west + i0 * g.cell, north: g.north - j0 * g.cell, cell: g.cell, data };
}

/**
 * The sea: cells at or below `seaLevel` that connect, through such cells, to the edge of the data.
 * A basin below sea level that dry land walls off from the edge is land (a depression), not sea
 * (findings register CR59, CR67). 1 = sea.
 */
export function oceanMask(g: GeoGrid, seaLevel: number): Uint8Array {
  const { width, height, data } = g;
  const mask = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let tail = 0;
  const seed = (c: number) => {
    if (!mask[c] && data[c]! <= seaLevel) {
      mask[c] = 1;
      queue[tail++] = c;
    }
  };
  for (let i = 0; i < width; i++) {
    seed(i);
    seed((height - 1) * width + i);
  }
  for (let j = 0; j < height; j++) {
    seed(j * width);
    seed(j * width + width - 1);
  }
  for (let head = 0; head < tail; head++) {
    const c = queue[head]!;
    const i = c % width;
    const j = (c - i) / width;
    if (i > 0) seed(c - 1);
    if (i < width - 1) seed(c + 1);
    if (j > 0) seed(c - width);
    if (j < height - 1) seed(c + width);
  }
  return mask;
}

