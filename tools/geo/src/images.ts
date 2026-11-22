/**
 * Image files: WebP for what ships, JPEG for the previews people look at. Uses sharp.
 * Also reads shipped assets back (for tests, verification and the Unity export).
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { Assets3dManifest, tilePath, type TerrainPatch } from "@dunialab/content";
import { decodeTerrainRgb, encodeTerrainRgb } from "./bake.js";
import { latToTileY, lonToTileX, type Bounds, type LonLat } from "./geo-math.js";

export async function heightWebp(heights: ArrayLike<number>, width: number, height: number, stepMetres: number): Promise<Buffer> {
  return sharp(Buffer.from(encodeTerrainRgb(heights, stepMetres)), { raw: { width, height, channels: 3 } })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
}

export async function rgbWebp(rgb: Uint8Array, width: number, height: number, quality: number): Promise<Buffer> {
  return sharp(Buffer.from(rgb), { raw: { width, height, channels: 3 } }).webp({ quality, effort: 5 }).toBuffer();
}

export async function greyWebp(grey: Uint8Array, width: number, height: number, quality: number): Promise<Buffer> {
  return sharp(Buffer.from(grey), { raw: { width, height, channels: 1 } }).webp({ quality, effort: 5 }).toBuffer();
}

/** A JPEG of an RGB image with an SVG drawn on top (lines, labels). */
export async function previewJpeg(rgb: Uint8Array, width: number, height: number, overlaySvg: string): Promise<Buffer> {
  return sharp(Buffer.from(rgb), { raw: { width, height, channels: 3 } })
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}

export async function readHeightWebp(file: string): Promise<{ data: Float32Array; width: number; height: number }> {
  // Read the bytes ourselves: handing sharp a path keeps the file open on Windows, which
  // then cannot be replaced or deleted while the process lives.
  const { data, info } = await sharp(readFileSync(file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: decodeTerrainRgb(data, info.channels), width: info.width, height: info.height };
}

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// ---- Git LFS pointers (CI does not download image files, ADR-0009) ----

const LFS_HEADER = "version https://git-lfs.github.com/spec/v1";

/** True when the file on disk is a Git LFS pointer instead of the real file. */
export function isLfsPointer(file: string): boolean {
  if (!existsSync(file) || statSync(file).size > 1024) return false;
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(LFS_HEADER.length);
    readSync(fd, head, 0, head.length, 0);
    return head.toString("utf8") === LFS_HEADER;
  } finally {
    closeSync(fd);
  }
}

/** The fingerprint and size a Git LFS pointer records for the real file. */
export function readLfsPointer(file: string): { sha256: string; bytes: number } | null {
  if (!isLfsPointer(file)) return null;
  const text = readFileSync(file, "utf8");
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text)?.[1];
  const size = /^size (\d+)$/m.exec(text)?.[1];
  return oid && size ? { sha256: oid, bytes: Number(size) } : null;
}

// ---- reading shipped assets ----

export interface PatchHeights {
  data: Float32Array;
  size: number;
  bounds: Bounds;
  /** Longitude/latitude of sample `index`. */
  lonLatOf(index: number): LonLat;
}

export interface AssetReader {
  manifest: Assets3dManifest;
  /** Heights of an HD patch, by feature id. */
  patchHeights(featureId: string): Promise<PatchHeights>;
  /** Terrain height at a point from the regional tiles. Open sea (no tile) is 0. */
  heightAt(point: LonLat): Promise<number>;
}

export function createAssetReader(dir: string): AssetReader {
  const manifest = Assets3dManifest.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
  const tiles = new Map<string, Promise<{ data: Float32Array; width: number; height: number }>>();
  const listed = new Set(manifest.regional.tiles.map((t) => `${t.x}/${t.y}`));
  const z = manifest.regional.zoom;

  return {
    manifest,
    async patchHeights(featureId) {
      const patch: TerrainPatch | undefined = manifest.patches.find((p) => p.featureId === featureId);
      if (!patch) throw new Error(`no patch for feature "${featureId}"`);
      const { data, width, height } = await readHeightWebp(join(dir, patch.dir, "h.webp"));
      // A wrong-sized image would map samples to the wrong places, or to NaN for 1 x 1 (CR76).
      if (width !== height || width !== patch.heightSize || width < 2) {
        throw new Error(`patch "${featureId}": the height image is ${width} x ${height}, the manifest says ${patch.heightSize} x ${patch.heightSize} (at least 2)`);
      }
      const [[w, s], [e, n]] = patch.bounds;
      return {
        data,
        size: width,
        bounds: patch.bounds as Bounds,
        lonLatOf: (index) => [w + ((index % width) / (width - 1)) * (e - w), n - (Math.floor(index / width) / (width - 1)) * (n - s)],
      };
    },
    async heightAt([lon, lat]) {
      const fx = lonToTileX(lon, z);
      const fy = latToTileY(lat, z);
      const x = Math.floor(fx);
      const y = Math.floor(fy);
      if (!listed.has(`${x}/${y}`)) return 0;
      const key = `${x}/${y}`;
      if (!tiles.has(key)) {
        const read = readHeightWebp(join(dir, tilePath(z, x, y, "h")));
        // Share pending and successful reads; forget a failed one so a later call can retry (CR75).
        read.catch(() => tiles.delete(key));
        tiles.set(key, read);
      }
      const tile = await tiles.get(key)!;
      const px = (fx - x) * (tile.width - 1);
      const py = (fy - y) * (tile.height - 1);
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const x1 = Math.min(tile.width - 1, x0 + 1);
      const y1 = Math.min(tile.height - 1, y0 + 1);
      const tx = px - x0;
      const ty = py - y0;
      const at = (i: number, j: number) => tile.data[j * tile.width + i]!;
      return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
    },
  };
}
