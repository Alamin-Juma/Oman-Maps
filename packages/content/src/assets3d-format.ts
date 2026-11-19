/**
 * The 3D asset encodings and paths, without any schema code (see assets3d.ts for the manifest
 * schema). Kept separate on purpose: the web app's first page load needs `tilePath` (to plan a
 * scene), and importing it from the schema module pulled the whole validation library into every
 * phone's first download.
 */
export const ASSETS3D_SCHEMA_VERSION = 1;
export const TERRAIN_RGB = { baseMetres: -10000, stepMetres: 0.1 } as const;

/** Decode one terrain-rgb pixel to metres. */
export function terrainRgbToMetres(r: number, g: number, b: number): number {
  return TERRAIN_RGB.baseMetres + (r * 65536 + g * 256 + b) * TERRAIN_RGB.stepMetres;
}

/** Path of one tile file relative to the manifest. */
export function tilePath(z_: number, x: number, y: number, file: "h" | "albedo" | "shade"): string {
  return `tiles/${z_}/${x}/${y}/${file}.webp`;
}
