/**
 * The scene planner (ADR-0008): decides WHAT the 3D view shows for a tapped feature.
 * The renderer only carries out the plan, so every decision here is unit-tested without WebGL.
 *
 * Behaviour comes from the feature's KIND and from the generated asset manifest, never from
 * an id (ADR-0004): a new pack gets 3D by being generated, not by editing this file.
 */
import {
  tilePath,
  type Assets3dManifest,
  type ContentPack,
  type Feature,
  type LakesFile,
  type LocalizedText,
  type RiversFile,
  type TerrainPatch,
} from "@dunialab/content";
import { KM_PER_DEG_LAT, haversineKm, kmPerDegLon, latToTileY, lonToTileX, tileXToLon, tileYToLat, type LonLat } from "./geo.js";

export type QualityTier = "low" | "medium" | "high";

export interface DeviceInfo {
  webgl2: boolean;
  /** `navigator.deviceMemory` (GB, rounded by the browser); unknown on some browsers. */
  deviceMemoryGB?: number;
}

/** Below this much memory a phone is not offered 3D at all; the 2D map stays. */
const MIN_MEMORY_GB = 1;

export function supports3d(device: DeviceInfo): boolean {
  return device.webgl2 && (device.deviceMemoryGB === undefined || device.deviceMemoryGB > MIN_MEMORY_GB);
}

export function chooseTier(device: DeviceInfo): QualityTier {
  const mem = device.deviceMemoryGB;
  if (mem === undefined) return "medium";
  if (mem >= 8) return "high";
  if (mem >= 4) return "medium";
  return "low";
}

/** Map elements (title, key, compass, scale) are part of the printed sheet, not of the land. */
export const has3d = (f: Feature) => f.kind !== "map-element";

/** Vertical exaggeration per view (brief §3.3: about x3 for the country, about x1.5 close up). */
const EXAGGERATION = { overview: 3, region: 2, patch: 1.5 } as const;
const RISE_MS = 1800;
/** Regional tiles loaded at most, per tier (each is about 0.4 MB). */
const MAX_TILES: Record<QualityTier, number> = { low: 4, medium: 9, high: 16 };
/** Use every n-th height sample when building meshes. */
const STRIDE: Record<QualityTier, number> = { low: 4, medium: 2, high: 1 };
const REGION_MIN_RADIUS_KM = 60;

export interface SceneTile {
  z: number;
  x: number;
  y: number;
}

export interface SceneLabel {
  featureId: string;
  anchor: LonLat;
  text: LocalizedText;
  kind: string;
}

export interface ScenePlan {
  mode: "overview" | "region" | "patch";
  feature: Feature | null;
  /** Centre of the scene; the local frame's origin. */
  focus: LonLat;
  patch: TerrainPatch | null;
  tiles: SceneTile[];
  /** Height samples skipped when building meshes (1 = all). */
  meshStride: number;
  exaggeration: { from: number; to: number; durationMs: number };
  exaggerationNote: LocalizedText;
  camera: { distanceKm: number; pitchDeg: number; headingDeg: number };
  lakeIds: string[];
  riverIds: string[];
  labels: SceneLabel[];
  /** Shown in the information card: the pack's approved facts, word for word. */
  title: LocalizedText;
  facts: LocalizedText[];
}

export interface PlanInput {
  pack: ContentPack;
  manifest: Assets3dManifest;
  /** null = the whole map. */
  featureId: string | null;
  lakes?: LakesFile;
  rivers?: RiversFile;
  tier: QualityTier;
  reducedMotion: boolean;
}

export function planScene(input: PlanInput): ScenePlan {
  const { pack, manifest, tier } = input;
  const feature = input.featureId ? (pack.features.find((f) => f.id === input.featureId) ?? null) : null;
  if (input.featureId && !feature) throw new Error(`planScene: no feature "${input.featureId}" in ${pack.id}`);
  if (feature && !has3d(feature)) throw new Error(`planScene: "${feature.id}" has no 3D view`);

  const patch = feature ? (manifest.patches.find((p) => p.featureId === feature.id) ?? null) : null;
  const lakeSummary = feature ? manifest.lakes.items.find((l) => l.featureId === feature.id) : undefined;
  const riverSummary = feature ? manifest.rivers.items.find((r) => r.featureId === feature.id) : undefined;

  let mode: ScenePlan["mode"];
  let focus: LonLat;
  let radiusKm: number;
  if (!feature) {
    mode = "overview";
    focus = centreOf(manifest.bounds);
    radiusKm = extentKm(manifest.bounds) / 2;
  } else if (patch) {
    mode = "patch";
    focus = [feature.anchor[0], feature.anchor[1]];
    radiusKm = patch.sizeKm / 2;
  } else if (riverSummary) {
    // A river is long: show it on the light country overview rather than many regional tiles.
    mode = "overview";
    const points = input.rivers?.rivers.find((r) => r.featureId === feature.id)?.points.map((p): LonLat => [p[0], p[1]]) ?? (feature.path as LonLat[] | undefined) ?? [feature.anchor as LonLat];
    const b = boundsOf(points);
    focus = centreOf(b);
    radiusKm = Math.max(REGION_MIN_RADIUS_KM, extentKm(b) / 2);
  } else {
    mode = "region";
    focus = [feature.anchor[0], feature.anchor[1]];
    radiusKm = lakeSummary ? Math.max(REGION_MIN_RADIUS_KM, Math.sqrt(lakeSummary.areaKm2 / Math.PI) * 1.4) : REGION_MIN_RADIUS_KM;
  }

  const tiles =
    mode === "overview"
      ? manifest.overview.tiles.map((t) => ({ z: manifest.overview.zoom, ...t }))
      : mode === "region"
        ? nearestTiles(manifest, focus, radiusKm, MAX_TILES[tier])
        : [];

  const to = EXAGGERATION[mode];
  const exaggeration = input.reducedMotion ? { from: to, to, durationMs: 0 } : { from: 0, to, durationMs: RISE_MS };

  const inView = (p: readonly [number, number]) => haversineKm([p[0], p[1]], focus) <= radiusKm * 1.15;
  const labels = pack.features
    .filter((f) => has3d(f) && (mode === "overview" || f.id === feature?.id || inView(f.anchor)))
    .map((f): SceneLabel => ({ featureId: f.id, anchor: [f.anchor[0], f.anchor[1]], text: f.name, kind: f.kind }));

  const lakeIds = manifest.lakes.items
    .filter((l) => mode === "overview" || l.featureId === feature?.id || (input.lakes?.lakes.find((x) => x.featureId === l.featureId)?.outline.some(inView) ?? false))
    .map((l) => l.featureId);
  const riverIds = manifest.rivers.items
    .filter((r) => (riverSummary ? r.featureId === feature?.id : mode === "overview" || (input.rivers?.rivers.find((x) => x.featureId === r.featureId)?.points.some((p) => inView([p[0], p[1]])) ?? false)))
    .map((r) => r.featureId);

  return {
    mode,
    feature,
    focus,
    patch,
    tiles,
    meshStride: STRIDE[tier],
    exaggeration,
    exaggerationNote: {
      en: `Heights shown ×${to} taller than real, so you can see them`,
      sw: `Urefu umeonyeshwa mara ${to} zaidi ya halisi, ili uweze kuuona`,
    },
    camera: {
      distanceKm: mode === "patch" ? radiusKm * 2.3 : radiusKm * 2.1,
      pitchDeg: mode === "overview" ? 50 : 40,
      headingDeg: 0,
    },
    lakeIds,
    riverIds,
    labels,
    title: feature?.name ?? pack.title,
    facts: feature?.facts ?? [],
  };
}

/** The files a plan needs (relative to the manifest), in the order to fetch them. */
export function plannedFiles(plan: ScenePlan, manifest: Assets3dManifest): string[] {
  const files: string[] = [];
  if (plan.patch) for (const f of ["h", "albedo", "shade"]) files.push(`${plan.patch.dir}/${f}.webp`);
  for (const t of plan.tiles) for (const f of ["h", "albedo", "shade"] as const) files.push(tilePath(t.z, t.x, t.y, f));
  if (plan.lakeIds.length) files.push(manifest.lakes.file);
  if (plan.riverIds.length) files.push(manifest.rivers.file);
  return files;
}

// ---- helpers ----

function nearestTiles(manifest: Assets3dManifest, focus: LonLat, radiusKm: number, max: number): SceneTile[] {
  const z = manifest.regional.zoom;
  const cx = lonToTileX(focus[0], z);
  const cy = latToTileY(focus[1], z);
  const tileKm = (360 / 2 ** z) * kmPerDegLon(focus[1]);
  return manifest.regional.tiles
    .map((t) => ({ z, ...t, d: Math.hypot(t.x + 0.5 - cx, t.y + 0.5 - cy) }))
    .filter((t) => t.d * tileKm <= radiusKm + tileKm * 0.75)
    .sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x)
    .slice(0, max)
    .map(({ z: tz, x, y }) => ({ z: tz, x, y }));
}

function boundsOf(points: readonly LonLat[]): [LonLat, LonLat] {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [[w, s], [e, n]];
}

const centreOf = (b: readonly [readonly [number, number], readonly [number, number]]): LonLat => [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];

function extentKm(b: readonly [readonly [number, number], readonly [number, number]]): number {
  const midLat = (b[0][1] + b[1][1]) / 2;
  return Math.max((b[1][0] - b[0][0]) * kmPerDegLon(midLat), (b[1][1] - b[0][1]) * KM_PER_DEG_LAT);
}

/** Bounds of a tile, [[west, south], [east, north]]. */
export function tileBounds(t: SceneTile): [LonLat, LonLat] {
  return [[tileXToLon(t.x, t.z), tileYToLat(t.y + 1, t.z)], [tileXToLon(t.x + 1, t.z), tileYToLat(t.y, t.z)]];
}
