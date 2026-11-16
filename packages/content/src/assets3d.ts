/**
 * 3D assets of a content pack (ADR-0009): the manifest and the small JSON files that sit
 * next to the terrain tiles in `content-assets/<packId>/3d/`.
 *
 * Written by the generator (tools/geo), read by the web 3D viewer, the Unity app and the
 * asset tests. Everything here is plain data: no file or network access.
 *
 * Encodings (stable; a change needs a new `schemaVersion`):
 * - height tiles: "terrain-rgb" in lossless WebP. metres = -10000 + (R*65536 + G*256 + B) * 0.1
 * - tiles: standard XYZ Web Mercator. Height images are (heightSize x heightSize) with the
 *   last row/column repeating the neighbour's first, so neighbouring meshes share an edge.
 * - patches: a square area in plain longitude/latitude (equirectangular), north up.
 * - albedo: surface colour without lighting. shade: baked relief light, greyscale, 255 = fully lit.
 */
import { z } from "zod";

const LonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const BoundsLonLat = z.tuple([LonLat, LonLat]);
const RelPath = z.string().regex(/^[a-z0-9][a-z0-9._/-]*$/, "relative, lower-case, forward slashes").refine((p) => !p.includes(".."), "no ..");
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const ASSETS3D_SCHEMA_VERSION = 1;
export const TERRAIN_RGB = { baseMetres: -10000, stepMetres: 0.1 } as const;

/** Decode one terrain-rgb pixel to metres. */
export function terrainRgbToMetres(r: number, g: number, b: number): number {
  return TERRAIN_RGB.baseMetres + (r * 65536 + g * 256 + b) * TERRAIN_RGB.stepMetres;
}

export const AssetFileRole = z.enum(["manifest-data", "overview-tile", "regional-tile", "patch", "preview"]);

export const AssetFile = z.object({
  path: RelPath,
  bytes: z.number().int().nonnegative(),
  sha256: Sha256,
  role: AssetFileRole,
  /** Ids of the entries in `sources` this file was derived from (for generated attribution). */
  sources: z.array(z.string()).default([]),
});
export type AssetFile = z.infer<typeof AssetFile>;

export const AssetSource = z.object({
  id: z.string(),
  title: z.string(),
  version: z.string(),
  licence: z.string(),
  licenceUrl: z.string().url(),
  /** Notices that must be shown to users (ADR-0009 section 4). */
  notices: z.array(z.string()).default([]),
});
export type AssetSource = z.infer<typeof AssetSource>;

const TileSet = z.object({
  zoom: z.number().int().min(0).max(16),
  heightSize: z.number().int().positive(),
  textureSize: z.number().int().positive(),
  /** Only tiles that contain land. A tile that is not listed is open sea. */
  tiles: z.array(z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() })),
});

export const TerrainPatch = z.object({
  featureId: z.string(),
  kind: z.string(),
  bounds: BoundsLonLat,
  sizeKm: z.number().positive(),
  heightSize: z.number().int().positive(),
  textureSize: z.number().int().positive(),
  /** Folder (relative to the manifest) holding h.webp, albedo.webp and shade.webp. */
  dir: RelPath,
  /** Lowest and highest elevation in the patch, metres, from the data (NOT for showing to children). */
  elevationRange: z.tuple([z.number(), z.number()]),
});
export type TerrainPatch = z.infer<typeof TerrainPatch>;

export const RiverSummary = z.object({
  featureId: z.string(),
  lengthKm: z.number().positive(),
  points: z.number().int().min(2),
  endsIn: z.enum(["sea", "lake"]),
  /** True when a surveyed guide line (Natural Earth) constrained the trace. */
  guided: z.boolean(),
  /** Largest distance between the traced course and the guide line, km. Null when unguided. */
  maxOffGuideKm: z.number().nonnegative().nullable(),
  sourceElevation: z.number(),
});
export type RiverSummary = z.infer<typeof RiverSummary>;

export const LakeSummary = z.object({
  featureId: z.string(),
  surfaceMetres: z.number(),
  /** Area of the part of the lake inside the pack's map, km2. */
  areaKm2: z.number().nonnegative(),
  /** True when the lake continues beyond the pack's map edge. */
  clippedByMap: z.boolean(),
});
export type LakeSummary = z.infer<typeof LakeSummary>;

export const ReviewFlag = z.object({ id: z.string(), message: z.string() });

export const Assets3dManifest = z.object({
  schemaVersion: z.literal(ASSETS3D_SCHEMA_VERSION),
  packId: z.string(),
  packVersion: z.string(),
  generator: z.object({ name: z.string(), version: z.string() }),
  bounds: BoundsLonLat,
  encoding: z.object({
    height: z.literal("terrain-rgb/webp-lossless"),
    heightStepMetres: z.number().positive(),
    albedo: z.literal("rgb/webp"),
    shade: z.literal("grey/webp"),
    tiles: z.literal("xyz-web-mercator"),
    patches: z.literal("equirectangular"),
  }),
  overview: TileSet,
  regional: TileSet,
  patches: z.array(TerrainPatch),
  rivers: z.object({ file: RelPath, items: z.array(RiverSummary) }),
  lakes: z.object({ file: RelPath, items: z.array(LakeSummary) }),
  sources: z.array(AssetSource),
  files: z.array(AssetFile),
  /** What a learner downloads, measured at generation time (previews are excluded). */
  delivery: z.object({
    first3dOpenBytes: z.number().int().nonnegative(),
    pack3dTotalBytes: z.number().int().nonnegative(),
    hdFeaturePatchBytes: z.record(z.string(), z.number().int().nonnegative()),
  }),
  review: z.object({
    status: z.enum(["draft", "in-review", "approved"]),
    flags: z.array(ReviewFlag),
  }),
});
export type Assets3dManifest = z.infer<typeof Assets3dManifest>;

/** rivers.json: one entry per river feature. Each point is [lon, lat, elevationMetres, distanceKm, widthHint 0..1]. */
export const RiversFile = z.object({
  schemaVersion: z.literal(ASSETS3D_SCHEMA_VERSION),
  rivers: z.array(
    z.object({
      featureId: z.string(),
      points: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()])).min(2),
    }),
  ),
});
export type RiversFile = z.infer<typeof RiversFile>;

/** lakes.json: one entry per lake feature. `outline` is a closed ring of [lon, lat]. */
export const LakesFile = z.object({
  schemaVersion: z.literal(ASSETS3D_SCHEMA_VERSION),
  lakes: z.array(
    z.object({
      featureId: z.string(),
      surfaceMetres: z.number(),
      outline: z.array(LonLat).min(4),
    }),
  ),
});
export type LakesFile = z.infer<typeof LakesFile>;

/** Path of one tile file relative to the manifest. */
export function tilePath(z_: number, x: number, y: number, file: "h" | "albedo" | "shade"): string {
  return `tiles/${z_}/${x}/${y}/${file}.webp`;
}
