/**
 * What to generate for a pack. Decided from the pack's map bounds and from each feature's
 * KIND, never from an id: this is what keeps new grades and countries content drops
 * (ADR-0004). Pure.
 */
import type { AssetSource, ContentPack } from "@dunialab/content";
import { squareAround, tilesForBounds, zoomForTileCount, type Bounds, type LonLat } from "./geo-math.js";
import type { GeoGrid } from "./grid.js";
import { gridFromFunction } from "./grid.js";
import { KM_PER_DEG_LAT } from "./geo-math.js";

export interface GeoParams {
  /** The country overview is the deepest zoom that needs at most this many tiles (keeps the first 3D open small). */
  maxOverviewTiles: number;
  /** Regional tiles are this many zoom levels deeper than the overview. */
  regionalZoomOffset: number;
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

export function buildPlan(pack: ContentPack, params: GeoParams = DEFAULT_PARAMS): GenerationPlan {
  const bounds = pack.printTarget.bounds as Bounds;
  const overviewZoom = zoomForTileCount(bounds, params.maxOverviewTiles);
  const regionalZoom = overviewZoom + params.regionalZoomOffset;
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
