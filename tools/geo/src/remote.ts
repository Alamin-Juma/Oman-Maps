/**
 * Real data sources (ADR-0009): Copernicus DEM, ESA WorldCover and Natural Earth rivers.
 * Build time only: learners' devices never contact these services.
 *
 * Everything read from the network is cached under the cache folder (default .cache/geo,
 * gitignored), so a second run is offline and fast. Files are Cloud-Optimised GeoTIFFs read
 * with HTTP range requests: we fetch the overview level or window we need, not whole files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fromArrayBuffer, fromUrl } from "geotiff";
import type { AssetSource } from "@dunialab/content";
import { distanceToPolylineKm, type Bounds, type LonLat } from "./geo-math.js";
import { makeGrid, type GeoGrid } from "./grid.js";
import type { ElevationSource, GuideRiverSource, LandCoverSource } from "./plan.js";

// ---- network: retries and accounting ----

export interface NetworkStats {
  requests: number;
  bytes: number;
  retries: number;
  milliseconds: number;
}

export const newNetworkStats = (): NetworkStats => ({ requests: 0, bytes: 0, retries: 0, milliseconds: 0 });

/**
 * Replace the global fetch with one that retries dropped connections and server errors
 * (seen in the Phase 0 spike: ECONNRESET from S3) and counts what crosses the network.
 * @returns a function that restores the original fetch.
 */
export function installRetryingFetch(stats: NetworkStats, maxRetries = 5): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const started = performance.now();
      try {
        const response = await original(input, init);
        if (response.status >= 500 && attempt < maxRetries) throw new Error(`HTTP ${response.status}`);
        const body = init?.method === "HEAD" ? null : await response.arrayBuffer();
        stats.requests++;
        stats.bytes += body?.byteLength ?? 0;
        stats.milliseconds += performance.now() - started;
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch (error) {
        stats.milliseconds += performance.now() - started;
        if (attempt >= maxRetries) throw error;
        stats.retries++;
        await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 400 * 2 ** attempt)));
      }
    }
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function inParallel<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
}

// ---- reading one window of one level of a Cloud-Optimised GeoTIFF, with a disk cache ----

interface Raster<T extends Float32Array | Uint8Array> {
  data: T;
  width: number;
  height: number;
  /** Geographic box covered by `data`: [west, south, east, north]. */
  box: [number, number, number, number];
}

interface CogRequest {
  url: string;
  /** Overview level wanted (0 = full detail). Clamped to what the file has. */
  level: number;
  /** Part wanted, in degrees. Null = the whole file. */
  want: Bounds | null;
  /** Snap windows outward to this many pixels, so overlapping requests reuse the cache. */
  snap: number;
  bytesPerSample: 1 | 4;
  /** Files up to this size are downloaded whole when the whole level is wanted. */
  wholeFileMaxBytes?: number;
}

async function readCog<T extends Float32Array | Uint8Array>(r: CogRequest): Promise<Raster<T> | null> {
  const head = await fetch(r.url, { method: "HEAD" });
  if (head.status === 404 || head.status === 403) return null; // no file here: open sea
  if (!head.ok) throw new Error(`HEAD ${r.url}: HTTP ${head.status}`);

  // A small file is fetched whole in one request: much faster than the many small range
  // requests geotiff makes (measured: about 15 s instead of 100 s for a 5 MB file).
  const fileBytes = Number(head.headers.get("content-length") ?? Infinity);
  let tiff: Awaited<ReturnType<typeof fromUrl>>;
  if (r.want === null && fileBytes <= (r.wholeFileMaxBytes ?? 0)) {
    const response = await fetch(r.url);
    if (!response.ok) throw new Error(`GET ${r.url}: HTTP ${response.status}`);
    tiff = await fromArrayBuffer(await response.arrayBuffer());
  } else {
    tiff = await fromUrl(r.url);
  }
  const level = Math.min(r.level, (await tiff.getImageCount()) - 1);
  const [bw, bs, be, bn] = (await tiff.getImage(0)).getBoundingBox() as [number, number, number, number];
  const image = await tiff.getImage(level);
  const W = image.getWidth();
  const H = image.getHeight();
  let [x0, y0, x1, y1] = [0, 0, W, H];
  if (r.want) {
    const snapDown = (v: number) => Math.floor(v / r.snap) * r.snap;
    const snapUp = (v: number) => Math.ceil(v / r.snap) * r.snap;
    x0 = Math.max(0, snapDown(((r.want[0][0] - bw) / (be - bw)) * W));
    x1 = Math.min(W, snapUp(((r.want[1][0] - bw) / (be - bw)) * W));
    y0 = Math.max(0, snapDown(((bn - r.want[1][1]) / (bn - bs)) * H));
    y1 = Math.min(H, snapUp(((bn - r.want[0][1]) / (bn - bs)) * H));
    if (x1 <= x0 || y1 <= y0) return null;
  }
  const box: [number, number, number, number] = [bw + (x0 / W) * (be - bw), bn - (y1 / H) * (bn - bs), bw + (x1 / W) * (be - bw), bn - (y0 / H) * (bn - bs)];
  const width = x1 - x0;
  const height = y1 - y0;
  const [band] = (await image.readRasters({ window: [x0, y0, x1, y1] })) as unknown as [ArrayLike<number>];
  const data = (r.bytesPerSample === 4 ? Float32Array.from(band) : Uint8Array.from(band)) as T;
  return { data, width, height, box };
}

/**
 * The cache key cannot be known before the file's size is (windows are in pixels), so a
 * small index remembers, per request, which cache entry answered it. A warm run then needs
 * no network at all, not even the HEAD request.
 */
function memo<T extends Float32Array | Uint8Array>(cacheDir: string) {
  const indexFile = join(cacheDir, "index.json");
  const index: Record<string, { file: string; width: number; height: number; box: [number, number, number, number] } | null> = existsSync(indexFile)
    ? JSON.parse(readFileSync(indexFile, "utf8"))
    : {};
  return async (id: string, bytesPerSample: 1 | 4, load: () => Promise<Raster<T> | null>, cacheFile: string): Promise<Raster<T> | null> => {
    const hit = index[id];
    if (hit === null) return null;
    if (hit && existsSync(hit.file)) {
      const buffer = readFileSync(hit.file);
      const data = (bytesPerSample === 4 ? new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)) as T;
      return { data, width: hit.width, height: hit.height, box: hit.box };
    }
    const raster = await load();
    if (raster) {
      const file = `${cacheFile}_${id.replace(/[^a-zA-Z0-9]+/g, "_").slice(-80)}.bin`;
      writeFileSync(file, Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength));
      index[id] = { file, width: raster.width, height: raster.height, box: raster.box };
    } else {
      index[id] = null;
    }
    writeFileSync(indexFile, JSON.stringify(index));
    return raster;
  };
}

/** Copy a raster into the part of a grid it covers. */
function blit(grid: GeoGrid<Float32Array | Uint8Array>, raster: Raster<Float32Array | Uint8Array>, smooth: boolean): void {
  const [bw, bs, be, bn] = raster.box;
  const i0 = Math.max(0, Math.floor((bw - grid.west) / grid.cell));
  const i1 = Math.min(grid.width, Math.ceil((be - grid.west) / grid.cell));
  const j0 = Math.max(0, Math.floor((grid.north - bn) / grid.cell));
  const j1 = Math.min(grid.height, Math.ceil((grid.north - bs) / grid.cell));
  const sx = raster.width / (be - bw);
  const sy = raster.height / (bn - bs);
  for (let j = j0; j < j1; j++) {
    const lat = grid.north - (j + 0.5) * grid.cell;
    if (lat > bn || lat < bs) continue;
    const fy = Math.max(0, Math.min(raster.height - 1, (bn - lat) * sy - 0.5));
    for (let i = i0; i < i1; i++) {
      const lon = grid.west + (i + 0.5) * grid.cell;
      if (lon < bw || lon > be) continue;
      const fx = Math.max(0, Math.min(raster.width - 1, (lon - bw) * sx - 0.5));
      if (!smooth) {
        grid.data[j * grid.width + i] = raster.data[Math.round(fy) * raster.width + Math.round(fx)]!;
        continue;
      }
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(raster.width - 1, x0 + 1);
      const y1 = Math.min(raster.height - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const d = raster.data;
      grid.data[j * grid.width + i] =
        (d[y0 * raster.width + x0]! * (1 - tx) + d[y0 * raster.width + x1]! * tx) * (1 - ty) + (d[y1 * raster.width + x0]! * (1 - tx) + d[y1 * raster.width + x1]! * tx) * ty;
    }
  }
}

function snappedGrid(bounds: Bounds, cell: number): GeoGrid {
  const west = Math.floor(bounds[0][0] / cell) * cell;
  const north = Math.ceil(bounds[1][1] / cell) * cell;
  const east = Math.ceil(bounds[1][0] / cell) * cell;
  const south = Math.floor(bounds[0][1] / cell) * cell;
  return makeGrid([[west, south], [east, north]], cell);
}

export interface RemoteOptions {
  cacheDir: string;
  log?: (message: string) => void;
  /** Override the data location (tests serve small files from localhost). */
  baseUrl?: string;
}

// ---- Copernicus DEM ----

const COPERNICUS_NOTICES = [
  "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.",
  "Produced using Copernicus WorldDEM-30 and WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.",
  "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30 and WorldDEM-90.",
];
const COPERNICUS_LICENCE_URL = "https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf";

interface DemChoice {
  product: "GLO-90" | "GLO-30";
  arcsec: 30 | 10;
  pixelsPerDegree: number;
  level: number;
  metres: number;
}
/** Coarsest first. Small GLO-90 files are preferred wherever their detail is enough. */
const DEM_CHOICES: DemChoice[] = [
  { product: "GLO-90", arcsec: 30, pixelsPerDegree: 1200, level: 2, metres: 371 },
  { product: "GLO-90", arcsec: 30, pixelsPerDegree: 1200, level: 1, metres: 185.5 },
  { product: "GLO-90", arcsec: 30, pixelsPerDegree: 1200, level: 0, metres: 92.8 },
  { product: "GLO-30", arcsec: 10, pixelsPerDegree: 3600, level: 1, metres: 61.8 },
  { product: "GLO-30", arcsec: 10, pixelsPerDegree: 3600, level: 0, metres: 30.9 },
];

export function chooseDem(metresPerPixel: number): DemChoice {
  return DEM_CHOICES.find((c) => c.metres <= metresPerPixel * 1.1) ?? DEM_CHOICES.at(-1)!;
}

export function copernicusTileName(lon: number, lat: number, arcsec: 10 | 30): string {
  const ns = `${lat < 0 ? "S" : "N"}${String(Math.abs(lat)).padStart(2, "0")}_00`;
  const ew = `${lon < 0 ? "W" : "E"}${String(Math.abs(lon)).padStart(3, "0")}_00`;
  return `Copernicus_DSM_COG_${arcsec}_${ns}_${ew}_DEM`;
}

export function copernicusDem(options: RemoteOptions & { baseUrl30?: string; baseUrl90?: string }): ElevationSource {
  const dir = join(options.cacheDir, "copernicus");
  mkdirSync(dir, { recursive: true });
  const cached = memo<Float32Array>(dir);
  const usedProducts = new Set<string>();
  const base = (c: DemChoice) =>
    c.product === "GLO-90" ? (options.baseUrl90 ?? "https://copernicus-dem-90m.s3.amazonaws.com") : (options.baseUrl30 ?? "https://copernicus-dem-30m.s3.amazonaws.com");

  return {
    used: () =>
      [...usedProducts].sort().map(
        (product): AssetSource => ({
          id: `copernicus-dem-${product.toLowerCase()}`,
          title: `Copernicus DEM ${product} (Digital Surface Model)`,
          version: "2021_1 or later, as served by the AWS Open Data registry",
          licence: `Licence for Copernicus DEM instance COP-DEM-${product}-F, Full, Free & Open`,
          licenceUrl: COPERNICUS_LICENCE_URL,
          notices: COPERNICUS_NOTICES,
        }),
      ),
    async read(bounds, metresPerPixel) {
      const choice = chooseDem(metresPerPixel);
      usedProducts.add(choice.product);
      const grid = snappedGrid(bounds, 2 ** choice.level / choice.pixelsPerDegree);
      const tiles: { lon: number; lat: number }[] = [];
      for (let lat = Math.floor(bounds[0][1]); lat < bounds[1][1]; lat++) for (let lon = Math.floor(bounds[0][0]); lon < bounds[1][0]; lon++) tiles.push({ lon, lat });
      let done = 0;
      await inParallel(tiles, 4, async ({ lon, lat }) => {
        const name = copernicusTileName(lon, lat, choice.arcsec);
        // Overview levels are small: read them whole. Full detail: only the window we need.
        const want: Bounds | null = choice.level === 0 && choice.product === "GLO-30" ? bounds : null;
        const id = `${name}|L${choice.level}|${want ? want.flat().map((v) => v.toFixed(4)).join(",") : "all"}`;
        const raster = await cached(
          id,
          4,
          () => readCog<Float32Array>({ url: `${base(choice)}/${name}/${name}.tif`, level: choice.level, want, snap: 512, bytesPerSample: 4, wholeFileMaxBytes: 16_000_000 }),
          join(dir, name),
        );
        if (raster) blit(grid, raster, true);
        if (++done % 10 === 0 || done === tiles.length) options.log?.(`  elevation ${choice.product} level ${choice.level}: ${done}/${tiles.length} files`);
      });
      return grid;
    },
  };
}

// ---- ESA WorldCover ----

const WORLDCOVER_METRES = 9.28; // 3 degrees / 36,000 pixels at the equator

export function worldCoverTileName(lon: number, lat: number): string {
  return `ESA_WorldCover_10m_2021_v200_${lat < 0 ? "S" : "N"}${String(Math.abs(lat)).padStart(2, "0")}${lon < 0 ? "W" : "E"}${String(Math.abs(lon)).padStart(3, "0")}_Map`;
}

export function worldCover(options: RemoteOptions): LandCoverSource {
  const dir = join(options.cacheDir, "worldcover");
  mkdirSync(dir, { recursive: true });
  const cached = memo<Uint8Array>(dir);
  const base = options.baseUrl ?? "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map";
  let wasUsed = false;
  return {
    used: () =>
      wasUsed
        ? [
            {
              id: "esa-worldcover-2021",
              title: "ESA WorldCover 10 m 2021 v200",
              version: "v200 (2021)",
              licence: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
              licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
              notices: ["© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium"],
            },
          ]
        : [],
    async read(bounds, metresPerPixel) {
      wasUsed = true;
      let level = 0;
      while (level < 6 && WORLDCOVER_METRES * 2 ** (level + 1) <= metresPerPixel * 1.1) level++;
      const cell = (3 / 36000) * 2 ** level;
      const base32 = snappedGrid(bounds, cell);
      const grid: GeoGrid<Uint8Array> = { ...base32, data: new Uint8Array(base32.width * base32.height) };
      const tiles: { lon: number; lat: number }[] = [];
      for (let lat = Math.floor(bounds[0][1] / 3) * 3; lat < bounds[1][1]; lat += 3) for (let lon = Math.floor(bounds[0][0] / 3) * 3; lon < bounds[1][0]; lon += 3) tiles.push({ lon, lat });
      let done = 0;
      await inParallel(tiles, 3, async ({ lon, lat }) => {
        const name = worldCoverTileName(lon, lat);
        // Coarse levels are small: read them whole, so every tile that needs the file shares one download.
        const want: Bounds | null = level >= 3 ? null : bounds;
        const id = `${name}|L${level}|${want ? want.flat().map((v) => v.toFixed(4)).join(",") : "all"}`;
        const raster = await cached(id, 1, () => readCog<Uint8Array>({ url: `${base}/${name}.tif`, level, want, snap: 1024, bytesPerSample: 1 }), join(dir, name));
        if (raster) blit(grid, raster, false);
        options.log?.(`  land cover level ${level}: ${++done}/${tiles.length} files`);
      });
      return grid;
    },
  };
}

// ---- Natural Earth river centre lines ----

const NATURAL_EARTH_RIVERS_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_rivers_lake_centerlines.geojson";

interface GeoJsonLines {
  features: { geometry: { type: string; coordinates: unknown } | null }[];
}

export function linesOf(geojson: GeoJsonLines): LonLat[][] {
  const lines: LonLat[][] = [];
  for (const f of geojson.features) {
    if (f.geometry?.type === "LineString") lines.push(f.geometry.coordinates as LonLat[]);
    else if (f.geometry?.type === "MultiLineString") lines.push(...(f.geometry.coordinates as LonLat[][]));
  }
  return lines;
}

/** Lines of which at least `minShare` of the points lie within `km` of the rough line. */
export function linesNearPath(lines: readonly LonLat[][], roughPath: readonly LonLat[], km: number, minShare = 0.25): LonLat[][] {
  const [w, s, e, n] = [
    Math.min(...roughPath.map((p) => p[0])) - 1,
    Math.min(...roughPath.map((p) => p[1])) - 1,
    Math.max(...roughPath.map((p) => p[0])) + 1,
    Math.max(...roughPath.map((p) => p[1])) + 1,
  ];
  return lines.filter((line) => {
    if (line.length < 2) return false;
    let near = 0;
    for (const p of line) if (p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n && distanceToPolylineKm(p, roughPath) <= km) near++;
    return near / line.length >= minShare;
  });
}

export function naturalEarthRivers(options: RemoteOptions & { file?: string }): GuideRiverSource {
  const dir = join(options.cacheDir, "natural-earth");
  const file = options.file ?? join(dir, "rivers.geojson");
  let lines: LonLat[][] | undefined;
  let wasUsed = false;
  return {
    used: () =>
      wasUsed
        ? [
            {
              id: "natural-earth-rivers",
              title: "Natural Earth 1:10m rivers and lake centre lines",
              version: "5.1.2",
              licence: "Public domain",
              licenceUrl: "https://www.naturalearthdata.com/about/terms-of-use/",
              notices: ["Made with Natural Earth."],
            },
          ]
        : [],
    async linesNear(roughPath, km) {
      if (!lines) {
        if (!existsSync(file)) {
          options.log?.("  downloading Natural Earth river lines");
          mkdirSync(dir, { recursive: true });
          const response = await fetch(options.baseUrl ?? NATURAL_EARTH_RIVERS_URL);
          if (!response.ok) throw new Error(`Natural Earth rivers: HTTP ${response.status}`);
          writeFileSync(file, Buffer.from(await response.arrayBuffer()));
        }
        lines = linesOf(JSON.parse(readFileSync(file, "utf8")) as GeoJsonLines);
      }
      const found = linesNearPath(lines, roughPath, km);
      if (found.length) wasUsed = true;
      return found;
    },
  };
}
