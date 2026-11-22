/**
 * Check a generated asset folder against its manifest: every file present, the right size,
 * the right fingerprint, nothing extra, and the whole thing inside the data budgets.
 *
 * Works on real files and on Git LFS pointers (a pointer records the real file's size and
 * SHA-256), so CI verifies assets without downloading them (ADR-0009).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Assets3dManifest, deliveryBudgetViolations, tilePath, type AssetFile } from "@dunialab/content";
import { readLfsPointer, sha256 } from "./images.js";

/** @returns one plain-language message per problem; empty when the folder is sound. */
export async function verifyAssets(dir: string): Promise<string[]> {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return [`${manifestPath}: missing (run "npm run geo:build")`];
  const manifestText = readFileSync(manifestPath, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(manifestText);
  } catch (e) {
    return [`manifest.json: not valid JSON (${(e as Error).message})`]; // findings register CR77
  }
  const parsed = Assets3dManifest.safeParse(json);
  if (!parsed.success) return parsed.error.issues.map((i) => `manifest.json ${i.path.join(".")}: ${i.message}`);
  const manifest = parsed.data;
  const problems: string[] = [];

  const actual = new Map<string, number>();
  for (const file of manifest.files) {
    const path = join(dir, file.path);
    if (!existsSync(path)) {
      problems.push(`${file.path}: listed in the manifest but missing`);
      continue;
    }
    const pointer = readLfsPointer(path);
    const bytes = pointer ? pointer.bytes : statSync(path).size;
    const hash = pointer ? pointer.sha256 : sha256(readFileSync(path));
    actual.set(file.path, bytes);
    if (bytes !== file.bytes) problems.push(`${file.path}: is ${bytes} bytes, the manifest says ${file.bytes}`);
    if (hash !== file.sha256) problems.push(`${file.path}: content does not match the manifest's fingerprint (changed or damaged)`);
  }

  const listed = new Set(manifest.files.map((f) => f.path));
  for (const path of walk(dir)) {
    if (path !== "manifest.json" && !listed.has(path)) problems.push(`${path}: on disk but not listed in the manifest`);
  }

  // Every tile the manifest names must have its three files, listed and present: the viewer asks for
  // them by these paths (findings register CR78).
  const levels = [
    ["overview", manifest.overview.zoom, manifest.overview.tiles],
    ["regional", manifest.regional.zoom, manifest.regional.tiles],
  ] as const;
  for (const [level, z, tiles] of levels) {
    for (const t of tiles) {
      for (const kind of ["h", "albedo", "shade"] as const) {
        const path = tilePath(z, t.x, t.y, kind);
        if (!listed.has(path)) problems.push(`${path}: named by the manifest's ${level} tiles but not listed in its files`);
        else if (!existsSync(join(dir, path))) problems.push(`${path}: named by the manifest's ${level} tiles but missing`);
      }
    }
  }

  // Budgets are judged on what is really on disk, not on what the manifest claims.
  const manifestBytes = Buffer.byteLength(manifestText);
  const size = (f: AssetFile) => actual.get(f.path) ?? 0;
  const shipped = manifest.files.filter((f) => f.role !== "preview");
  const sum = (list: AssetFile[]) => list.reduce((total, f) => total + size(f), 0);
  const delivery = {
    first3dOpenBytes: manifestBytes + sum(shipped.filter((f) => f.role === "overview-tile" || f.role === "manifest-data")),
    pack3dTotalBytes: manifestBytes + sum(shipped),
    hdFeaturePatchBytes: Object.fromEntries(manifest.patches.map((p) => [p.featureId, sum(shipped.filter((f) => f.path.startsWith(`${p.dir}/`)))])),
  };
  problems.push(...deliveryBudgetViolations(delivery));
  if (problems.length === 0) {
    // Every recorded figure must match what was measured, not only the total (findings register CR79).
    const recorded = manifest.delivery;
    if (delivery.pack3dTotalBytes !== recorded.pack3dTotalBytes) {
      problems.push(`manifest.json: records ${recorded.pack3dTotalBytes} bytes in total, the files add up to ${delivery.pack3dTotalBytes}`);
    }
    if (delivery.first3dOpenBytes !== recorded.first3dOpenBytes) {
      problems.push(`manifest.json: records ${recorded.first3dOpenBytes} bytes for the first 3D open, the files add up to ${delivery.first3dOpenBytes}`);
    }
    const ids = new Set([...Object.keys(recorded.hdFeaturePatchBytes), ...Object.keys(delivery.hdFeaturePatchBytes)]);
    for (const id of [...ids].sort()) {
      const was = recorded.hdFeaturePatchBytes[id];
      const is = delivery.hdFeaturePatchBytes[id];
      if (was === undefined) problems.push(`manifest.json: has no recorded size for the HD patch "${id}"`);
      else if (is === undefined) problems.push(`manifest.json: records a size for an HD patch "${id}" that it does not have`);
      else if (was !== is) problems.push(`manifest.json: records ${was} bytes for the HD patch "${id}", its files add up to ${is}`);
    }
  }
  return problems;
}

/** Bytes of every image file in the folder that Git LFS stores (everything except JSON and Markdown). */
export function lfsBytes(dir: string): number {
  let total = 0;
  for (const path of walk(dir)) {
    if (/\.(json|md)$/.test(path)) continue;
    const full = join(dir, path);
    total += readLfsPointer(full)?.bytes ?? statSync(full).size;
  }
  return total;
}

function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(dir, rel));
    else out.push(rel);
  }
  return out;
}
