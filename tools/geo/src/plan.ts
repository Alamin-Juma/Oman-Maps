/**
 * What to generate for a pack. Decided from the pack's map bounds and from each feature's
 * KIND, never from an id: this is what keeps new grades and countries content drops
 * (ADR-0004). Pure.
 */
import type { AssetSource, ContentPack } from "@dunialab/content";
import { squareAround, tileCountForBounds, tilesForBounds, zoomForTileCount, type Bounds, type LonLat } from "./geo-math.js";
import type { GeoGrid } from "./grid.js";
import { gridFromFunction } from "./grid.js";
import { KM_PER_DEG_LAT } from "./geo-math.js";

export interface GeoParams {
  /** The country overview is the deepest zoom that needs at most this many tiles (keeps the first 3D open small). */
  maxOverviewTiles: number;
  /** Regional tiles are this many zoom levels deeper than the overview (an integer, at least 1). */
  regionalZoomOffset: number;
  /**
   * Most regional tiles one pack may have: a guard on the generator's memory and run time against a
   * mistyped `--params`, not a delivery budget (those are DELIVERY_BUDGET, checked after generation).
   */
  maxRegionalTiles: number;
  /** Height image size per tile (2^n + 1, so neighbours share an edge and meshes can be built adaptively). */
  heightSize: number;
  /** Colour and relief-light image size per overview tile. */
  textureSize: number;
  /**
   * Colour and relief-light image size per regional tile. These are baked tile by tile from
   * finer elevation data than the whole-map pass uses, so memory stays small.
   */
  regionalTextureSize: number;
  patchHeightSize: number;
  patchTextureSize: number;
  /** Which feature kinds get an HD close-up patch, and how wide it is (km). */
  patchKmByKind: Readonly<Record<string, number>>;
  /** Detail of the regional elevation used for tiles and river tracing, metres per pixel. */
  regionalMetresPerPixel: number;
  /** Extra data read around the map so shading and lakes are right at the edges, degrees. */
  marginDeg: number;
  /** Heights are rounded to this before storing (smaller files; 1 m is invisible). */
  heightStepMetres: number;
  /** Relief exaggeration used ONLY for baked light, per level (coarser levels need more to stay readable). */
  shadeZFactor: { overview: number; regional: number; patch: number };
  albedoQuality: number;
  shadeQuality: number;
  /** Surveyed river lines within this distance of the pack's rough line are used as guides, km. */
  guideSearchKm: number;
}

export const DEFAULT_PARAMS: GeoParams = {
  maxOverviewTiles: 9,
  regionalZoomOffset: 2,
  maxRegionalTiles: 1024,
  heightSize: 257,
  textureSize: 512,
  regionalTextureSize: 1024,
  patchHeightSize: 513,
  patchTextureSize: 1024,
  patchKmByKind: { mountain: 40, valley: 60 },
  regionalMetresPerPixel: 185,
  marginDeg: 0.2,
  heightStepMetres: 1,
  shadeZFactor: { overview: 7, regional: 3.5, patch: 1.6 },
  albedoQuality: 82,
  shadeQuality: 80,
  guideSearchKm: 30,
};

export interface PatchPlan {
  featureId: string;
  kind: string;
  centre: LonLat;
  sizeKm: number;
  bounds: Bounds;
}

export interface GenerationPlan {
  bounds: Bounds;
  overviewZoom: number;
  regionalZoom: number;
  overviewTiles: { x: number; y: number }[];
  regionalTiles: { x: number; y: number }[];
  patches: PatchPlan[];
  rivers: { featureId: string; roughPath: LonLat[] }[];
  lakes: { featureId: string; anchor: LonLat }[];
}

/**
 * Refuse parameters that would produce broken assets (findings register CR64-CR66). `--params` comes
 * from the command line, so this runs in `buildPlan`, BEFORE generatePack deletes the old assets.
 */
export function checkParams(params: GeoParams): void {
  const isInt = (v: unknown, min: number) => typeof v === "number" && Number.isInteger(v) && v >= min;
  const twoPowerPlusOne = (v: unknown) => isInt(v, 3) && Number.isInteger(Math.log2((v as number) - 1));
  if (!isInt(params.maxOverviewTiles, 1)) throw new Error(`maxOverviewTiles must be a whole number of at least 1, got ${String(params.maxOverviewTiles)}`);
  // 0 would put overview and regional tiles at the same paths with different contents (CR65).
  if (!isInt(params.regionalZoomOffset, 1)) throw new Error(`regionalZoomOffset must be a whole number of at least 1, got ${String(params.regionalZoomOffset)}`);
  if (!isInt(params.maxRegionalTiles, 1)) throw new Error(`maxRegionalTiles must be a whole number of at least 1, got ${String(params.maxRegionalTiles)}`);
  for (const key of ["heightSize", "patchHeightSize"] as const) {
    // Heights are sampled at size - 1 intervals: 1 divides by zero (CR66).
    if (!twoPowerPlusOne(params[key])) throw new Error(`${key} must be 2^n + 1 with n >= 1 (3, 5, 9, ..., 257), got ${String(params[key])}`);
  }
}

export function buildPlan(pack: ContentPack, params: GeoParams = DEFAULT_PARAMS): GenerationPlan {
  checkParams(params);
  const bounds = pack.printTarget.bounds as Bounds;
  const overviewZoom = zoomForTileCount(bounds, params.maxOverviewTiles);
  const regionalZoom = overviewZoom + params.regionalZoomOffset;
  // Count before building the list: a mistyped offset would otherwise allocate millions (CR64).
  const regionalCount = tileCountForBounds(bounds, regionalZoom);
  if (regionalCount > params.maxRegionalTiles) {
    throw new Error(`${regionalCount} regional tiles at zoom ${regionalZoom} is more than maxRegionalTiles (${params.maxRegionalTiles}); lower regionalZoomOffset`);
  }
  const byId = [...pack.features].sort((a, b) => a.id.localeCompare(b.id, "en"));
  return {
    bounds,
    overviewZoom,
    regionalZoom,
    overviewTiles: tilesForBounds(bounds, overviewZoom),
    regionalTiles: tilesForBounds(bounds, regionalZoom),
    patches: byId
      .filter((f) => params.patchKmByKind[f.kind] !== undefined)
      .map((f) => {
        const sizeKm = params.patchKmByKind[f.kind]!;
        return { featureId: f.id, kind: f.kind, centre: f.anchor as LonLat, sizeKm, bounds: squareAround(f.anchor as LonLat, sizeKm) };
      }),
    rivers: byId.filter((f) => f.kind === "river" && f.path && f.path.length >= 2).map((f) => ({ featureId: f.id, roughPath: f.path as LonLat[] })),
    lakes: byId.filter((f) => f.kind === "lake").map((f) => ({ featureId: f.id, anchor: f.anchor as LonLat })),
  };
}

// ---- data sources (ports): the generator depends on these, not on any provider ----

export interface ElevationSource {
  /** Datasets this source may use; the ones actually read are reported by `used()`. */
  used(): AssetSource[];
  /** Elevation over the bounds at about `metresPerPixel` or finer. Open sea is 0. */
  read(bounds: Bounds, metresPerPixel: number): Promise<GeoGrid>;
}

export interface LandCoverSource {
  used(): AssetSource[];
  /** Land-cover class per cell (ESA WorldCover legend; 0 = unknown). */
  read(bounds: Bounds, metresPerPixel: number): Promise<GeoGrid<Uint8Array>>;
}

export interface GuideRiverSource {
  used(): AssetSource[];
  /** Surveyed river lines that run near the given rough line. */
  linesNear(roughPath: readonly LonLat[], km: number): Promise<LonLat[][]>;
}

export interface GeoSources {
  elevation: ElevationSource;
  landCover?: LandCoverSource;
  guideRivers?: GuideRiverSource;
}

/** Elevation from a formula. For tests and demos: no files, no network. */
export function syntheticElevation(heightAt: (lon: number, lat: number) => number): ElevationSource {
  return {
    used: () => [
      {
        id: "synthetic-elevation",
        title: "Synthetic elevation (formula, test data)",
        version: "1",
        licence: "Not applicable (generated)",
        licenceUrl: "https://example.org/not-applicable",
        notices: [],
      },
    ],
    read: async (bounds, metresPerPixel) => gridFromFunction(bounds, metresPerPixel / 1000 / KM_PER_DEG_LAT, heightAt),
  };
}
