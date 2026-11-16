/**
 * Builds the arrays three.js draws: terrain grids (with "skirt" walls so a patch looks like
 * a block of land lifted off the map), river ribbons and lake outlines. Pure: no three.js,
 * no DOM, so every shape is unit-tested.
 *
 * Heights are kept in a separate attribute (km), and the vertex shader multiplies them by
 * the exaggeration. That is what lets the land "rise" every frame without rebuilding meshes.
 */
import { TERRAIN_RGB } from "@dunialab/content";
import type { LonLat } from "./geo.js";

/** Decode terrain-rgb pixels (RGBA, as from a canvas) to metres. */
export function decodeHeights(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    out[i] = TERRAIN_RGB.baseMetres + (rgba[i * 4]! * 65536 + rgba[i * 4 + 1]! * 256 + rgba[i * 4 + 2]!) * TERRAIN_RGB.stepMetres;
  }
  return out;
}

export interface MeshArrays {
  /** x, 0, z per vertex (km); y comes from `heightsKm` in the shader. */
  positions: Float32Array;
  heightsKm: Float32Array;
  /** 1 for skirt (wall-bottom) vertices, 0 for the land surface. */
  skirt: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface GridInput {
  /** Heights in metres, `size` x `size`, row 0 at the north. */
  heights: Float32Array;
  size: number;
  /** Use every `stride`-th sample. (size - 1) must be divisible by it. */
  stride: number;
  /** Longitude/latitude of a point given as fractions across the grid (0..1, from the north-west). */
  lonLatAt: (u: number, v: number) => LonLat;
  /** Converts longitude/latitude to the scene's local km frame. */
  toLocal: (p: readonly [number, number]) => [number, number];
  /** Add walls down to the base around the edge (for lifted patches). */
  withSkirt: boolean;
}

export function buildGrid(g: GridInput): MeshArrays {
  if ((g.size - 1) % g.stride !== 0) throw new Error(`buildGrid: size ${g.size} - 1 is not divisible by stride ${g.stride}`);
  const n = (g.size - 1) / g.stride + 1;
  const surface = n * n;
  const ring = g.withSkirt ? 4 * (n - 1) : 0;
  const count = surface + ring;
  const positions = new Float32Array(count * 3);
  const heightsKm = new Float32Array(count);
  const skirt = new Float32Array(count);
  const uvs = new Float32Array(count * 2);

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const u = c / (n - 1);
      const v = r / (n - 1);
      const [x, z] = g.toLocal(g.lonLatAt(u, v));
      positions[i * 3] = x;
      positions[i * 3 + 2] = z;
      heightsKm[i] = g.heights[r * g.stride * g.size + c * g.stride]! / 1000;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = 1 - v; // textures are loaded north-up with flipY
    }
  }

  const tris: number[] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const a = r * n + c;
      tris.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }

  if (g.withSkirt) {
    // Walk the edge clockwise (as seen from above): north edge west->east, east edge north->south, ...
    const edge: number[] = [];
    for (let c = 0; c < n - 1; c++) edge.push(c);
    for (let r = 0; r < n - 1; r++) edge.push(r * n + (n - 1));
    for (let c = n - 1; c > 0; c--) edge.push((n - 1) * n + c);
    for (let r = n - 1; r > 0; r--) edge.push(r * n);
    edge.forEach((top, k) => {
      const i = surface + k;
      positions[i * 3] = positions[top * 3]!;
      positions[i * 3 + 2] = positions[top * 3 + 2]!;
      heightsKm[i] = heightsKm[top]!;
      skirt[i] = 1;
      uvs[i * 2] = uvs[top * 2]!;
      uvs[i * 2 + 1] = uvs[top * 2 + 1]!;
    });
    for (let k = 0; k < edge.length; k++) {
      const top0 = edge[k]!;
      const top1 = edge[(k + 1) % edge.length]!;
      const bottom0 = surface + k;
      const bottom1 = surface + ((k + 1) % edge.length);
      // Faces point outward.
      tris.push(top0, top1, bottom0, top1, bottom1, bottom0);
    }
  }

  return { positions, heightsKm, skirt, uvs, indices: Uint32Array.from(tris) };
}

/** Height (metres) at a fraction across a grid, bilinear. */
export function sampleGrid(heights: Float32Array, size: number, u: number, v: number): number {
  const fx = Math.max(0, Math.min(size - 1, u * (size - 1)));
  const fy = Math.max(0, Math.min(size - 1, v * (size - 1)));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number) => heights[y * size + x]!;
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

export interface RibbonArrays {
  positions: Float32Array;
  heightsKm: Float32Array;
  /** Distance along the line, km (for flow animation later). */
  along: Float32Array;
  indices: Uint32Array;
}

/**
 * A flat ribbon following a line, for rivers.
 * @param points [lon, lat, elevationMetres, distanceKm, widthHint 0..1]
 * @param widthKm width of the ribbon for a width hint (rivers widen downstream)
 */
export function buildRibbon(
  points: readonly (readonly [number, number, number, number, number])[],
  toLocal: (p: readonly [number, number]) => [number, number],
  widthKm: (hint: number) => number,
  liftMetres = 0,
): RibbonArrays {
  const n = points.length;
  if (n < 2) throw new Error("buildRibbon: needs at least two points");
  const local = points.map((p) => toLocal([p[0], p[1]]));
  const positions = new Float32Array(n * 2 * 3);
  const heightsKm = new Float32Array(n * 2);
  const along = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const prev = local[Math.max(0, i - 1)]!;
    const next = local[Math.min(n - 1, i + 1)]!;
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const half = widthKm(points[i]![4]) / 2;
    const [x, z] = local[i]!;
    // Left and right of the direction of flow.
    positions.set([x - dz * half, 0, z + dx * half, x + dz * half, 0, z - dx * half], i * 6);
    heightsKm[i * 2] = heightsKm[i * 2 + 1] = (points[i]![2] + liftMetres) / 1000;
    along[i * 2] = along[i * 2 + 1] = points[i]![3];
  }
  const tris: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    tris.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  return { positions, heightsKm, along, indices: Uint32Array.from(tris) };
}

/** A lake outline in the local frame as a flat shape's points ([x, -z] so it can be laid down with rotateX(-90°)). */
export function lakeShapePoints(outline: readonly (readonly [number, number])[], toLocal: (p: readonly [number, number]) => [number, number]): [number, number][] {
  const pts = outline.map((p) => {
    const [x, z] = toLocal(p);
    return [x, -z] as [number, number];
  });
  const first = pts[0];
  const last = pts.at(-1);
  if (first && last && first[0] === last[0] && first[1] === last[1]) pts.pop();
  return pts;
}
