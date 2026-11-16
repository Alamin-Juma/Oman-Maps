import { Assets3dManifest, LakesFile, RiversFile, type ContentPack } from "@dunialab/content";
import { NoColorSpace, TextureLoader, type Texture } from "three";
import { planScene, plannedFiles, type QualityTier, type ScenePlan } from "./plan.js";
import { decodeHeights } from "./terrain.js";

export const UNAVAILABLE = "3D is not available for this map yet";
export const assetsBase = (packId: string, base = import.meta.env.BASE_URL) =>
  `${base}content-assets/${encodeURIComponent(packId)}/3d/`;

async function json(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

export async function loadManifest(packId: string, signal: AbortSignal): Promise<Assets3dManifest> {
  try {
    const manifest = Assets3dManifest.parse(await json(`${assetsBase(packId)}manifest.json`, signal));
    if (manifest.packId !== packId) throw new Error("Asset pack does not match");
    return manifest;
  } catch (cause) {
    throw new Error(UNAVAILABLE, { cause });
  }
}

export async function runLimited<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  let failed = false;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (!failed && next < jobs.length) {
      const index = next++;
      try { results[index] = await jobs[index]!(); }
      catch (error) { failed = true; throw error; }
    }
  }));
  for (const worker of workers) if (worker.status === "rejected") throw worker.reason;
  return results;
}

export interface HeightGrid { heights: Float32Array; size: number }
export interface LoadedScene {
  manifest: Assets3dManifest;
  plan: ScenePlan;
  lakes: LakesFile;
  rivers: RiversFile;
  grids: Map<string, HeightGrid>;
  textures: Map<string, Texture>;
  dispose(): void;
}

async function heightGrid(url: string, signal: AbortSignal): Promise<HeightGrid> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  try {
    if (bitmap.width !== bitmap.height) throw new Error("Height grid must be square");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Height image decoding is unavailable");
    context.drawImage(bitmap, 0, 0);
    return { heights: decodeHeights(context.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height), size: bitmap.width };
  } finally { bitmap.close(); }
}

export async function loadScene(pack: ContentPack, featureId: string | null, tier: QualityTier, reducedMotion: boolean, signal: AbortSignal): Promise<LoadedScene> {
  const textures = new Map<string, Texture>();
  const dispose = () => { for (const texture of textures.values()) texture.dispose(); };
  try {
    const manifest = await loadManifest(pack.id, signal);
    const base = assetsBase(pack.id);
    const input = { pack, manifest, featureId, tier, reducedMotion };
    const initial = planScene(input);
    const allowed = new Set(manifest.files.filter((f) => f.role !== "preview").map((f) => f.path));
    const url = (path: string) => {
      if (!allowed.has(path)) throw new Error(`Unlisted asset: ${path}`);
      return base + path;
    };
    const [lakes, rivers] = await Promise.all([
      initial.lakeIds.length ? json(url(manifest.lakes.file), signal).then((value) => LakesFile.parse(value)) : Promise.resolve({ schemaVersion: 1 as const, lakes: [] }),
      initial.riverIds.length ? json(url(manifest.rivers.file), signal).then((value) => RiversFile.parse(value)) : Promise.resolve({ schemaVersion: 1 as const, rivers: [] }),
    ]);
    const plan = planScene({ ...input, lakes, rivers });
    const grids = new Map<string, HeightGrid>();
    const loader = new TextureLoader();
    await runLimited(plannedFiles(plan, manifest).filter((path) => path.endsWith(".webp")).map((path) => async () => {
      signal.throwIfAborted();
      if (path.endsWith("/h.webp")) {
        grids.set(path, await heightGrid(url(path), signal));
      } else {
        const texture = await loader.loadAsync(url(path));
        texture.colorSpace = NoColorSpace;
        textures.set(path, texture);
      }
      signal.throwIfAborted();
    }));
    signal.throwIfAborted();
    return { manifest, plan, lakes, rivers, grids, textures, dispose };
  } catch (cause) {
    dispose();
    throw new Error(UNAVAILABLE, { cause });
  }
}
