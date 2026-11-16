/**
 * Baking: turn elevation (and land cover) into the images the phone draws.
 * This is where the "HD look on a cheap phone" comes from (ADR-0008): relief light and
 * surface colour are computed here, once, at a higher resolution than the mesh.
 * Pure: arrays in, arrays out.
 */
import { TERRAIN_RGB } from "@dunialab/content";

// ---- terrain-rgb ----

/** Encode metres as terrain-rgb bytes (RGB, 3 bytes per sample), rounding to `stepMetres`. */
export function encodeTerrainRgb(heights: ArrayLike<number>, stepMetres = 1): Uint8Array {
  const out = new Uint8Array(heights.length * 3);
  const unitsPerStep = Math.max(1, Math.round(stepMetres / TERRAIN_RGB.stepMetres));
  for (let i = 0; i < heights.length; i++) {
    const metres = Number.isFinite(heights[i]!) ? heights[i]! : 0;
    const units = Math.round((metres - TERRAIN_RGB.baseMetres) / TERRAIN_RGB.stepMetres / unitsPerStep) * unitsPerStep;
    const v = Math.max(0, Math.min(0xffffff, units));
    out[i * 3] = (v >> 16) & 0xff;
    out[i * 3 + 1] = (v >> 8) & 0xff;
    out[i * 3 + 2] = v & 0xff;
  }
  return out;
}

export function decodeTerrainRgb(rgb: ArrayLike<number>, channels = 3): Float32Array {
  const n = Math.floor(rgb.length / channels);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = TERRAIN_RGB.baseMetres + (rgb[i * channels]! * 65536 + rgb[i * channels + 1]! * 256 + rgb[i * channels + 2]!) * TERRAIN_RGB.stepMetres;
  }
  return out;
}

// ---- relief shading ----

export interface ShadeOptions {
  /** Ground size of one sample, metres. */
  metresPerPixel: number;
  /** Heights are multiplied by this before lighting, so relief stays readable at coarse scales. */
  zFactor: number;
  /** Compass direction the light comes FROM, degrees (315 = north-west, the cartographic convention). */
  sunAzimuth?: number;
  /** Height of the sun above the horizon, degrees. */
  sunAltitude?: number;
}

/**
 * Baked relief light for an image of `width` x `height` pixels.
 * `heights` must include a margin of `margin` samples on every side:
 * (width + 2*margin) x (height + 2*margin) values, row 0 at the north.
 * Returns greyscale bytes, 255 = fully lit. Flat ground is light grey; slopes facing the sun
 * are brighter, slopes facing away and hollows are darker.
 */
export function bakeShade(heights: Float32Array, width: number, height: number, margin: number, o: ShadeOptions): Uint8Array {
  const fullW = width + 2 * margin;
  const fullH = height + 2 * margin;
  if (heights.length !== fullW * fullH) throw new Error(`bakeShade: expected ${fullW * fullH} heights, got ${heights.length}`);
  if (margin < 1) throw new Error("bakeShade: margin must be at least 1");
  const az = ((o.sunAzimuth ?? 315) * Math.PI) / 180;
  const alt = ((o.sunAltitude ?? 45) * Math.PI) / 180;
  const lx = Math.sin(az) * Math.cos(alt); // east
  const ly = Math.cos(az) * Math.cos(alt); // north
  const lz = Math.sin(alt);
  const k = o.zFactor / (2 * o.metresPerPixel);

  // Hollows: how far a point sits below the average of its surroundings.
  const blurred = boxBlur(heights, fullW, fullH, margin);
  const hollowScale = o.zFactor / (o.metresPerPixel * margin);

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = (y + margin) * fullW + (x + margin);
      const dzdx = (heights[c + 1]! - heights[c - 1]!) * k; // eastward slope
      const dzdy = (heights[c - fullW]! - heights[c + fullW]!) * k; // northward slope
      const inv = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const lambert = Math.max(0, (-dzdx * lx - dzdy * ly + lz) * inv);
      const lit = 0.3 + 0.55 * (lambert / lz);
      const hollow = Math.max(0, Math.min(0.35, (blurred[c]! - heights[c]!) * hollowScale * 0.6));
      out[y * width + x] = Math.round(255 * Math.max(0, Math.min(1, lit * (1 - hollow))));
    }
  }
  return out;
}

/** Box blur with the given radius over a `width` x `height` image; edges use the available samples. */
export function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const pass = (from: Float32Array, to: Float32Array, lines: number, length: number, stride: number, lineStride: number) => {
    for (let line = 0; line < lines; line++) {
      const base = line * lineStride;
      let sum = 0;
      let count = 0;
      for (let i = 0; i <= Math.min(radius, length - 1); i++) {
        sum += from[base + i * stride]!;
        count++;
      }
      for (let i = 0; i < length; i++) {
        to[base + i * stride] = sum / count;
        const add = i + radius + 1;
        const drop = i - radius;
        if (add < length) {
          sum += from[base + add * stride]!;
          count++;
        }
        if (drop >= 0) {
          sum -= from[base + drop * stride]!;
          count--;
        }
      }
    }
  };
  pass(src, tmp, height, width, 1, width); // along rows
  pass(tmp, out, width, height, width, 1); // along columns
  return out;
}

// ---- surface colour ----

type Rgb = readonly [number, number, number];

/** Colour by elevation alone: green lowlands, tan uplands, brown and grey mountains. */
const HYPSOMETRIC: readonly (readonly [number, Rgb])[] = [
  [0, [168, 198, 143]],
  [300, [186, 201, 140]],
  [900, [212, 208, 150]],
  [1600, [205, 188, 132]],
  [2400, [176, 150, 104]],
  [3200, [150, 124, 96]],
  [4000, [158, 148, 136]],
  [4800, [196, 192, 186]],
  [5600, [240, 240, 238]],
];

export function hypsometricColour(metres: number): Rgb {
  const stops = HYPSOMETRIC;
  if (metres <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [h1, c1] = stops[i]!;
    if (metres <= h1) {
      const [h0, c0] = stops[i - 1]!;
      const t = (metres - h0) / (h1 - h0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return stops.at(-1)![1];
}

/** ESA WorldCover class codes (the standard legend), mapped to natural-looking colours. */
export const LAND_COVER = {
  noData: 0,
  tree: 10,
  shrub: 20,
  grass: 30,
  crop: 40,
  built: 50,
  bare: 60,
  snow: 70,
  water: 80,
  wetland: 90,
  mangrove: 95,
  moss: 100,
} as const;

const LAND_COVER_COLOUR: Record<number, Rgb> = {
  [LAND_COVER.tree]: [62, 112, 62],
  [LAND_COVER.shrub]: [156, 160, 98],
  [LAND_COVER.grass]: [172, 186, 112],
  [LAND_COVER.crop]: [196, 192, 124],
  [LAND_COVER.built]: [176, 158, 148],
  [LAND_COVER.bare]: [216, 198, 162],
  [LAND_COVER.snow]: [246, 248, 250],
  [LAND_COVER.wetland]: [96, 150, 128],
  [LAND_COVER.mangrove]: [64, 118, 92],
  [LAND_COVER.moss]: [188, 198, 170],
};

export const SEA_COLOUR: Rgb = [52, 104, 152];
export const FRESH_WATER_COLOUR: Rgb = [74, 136, 184];

/**
 * Surface colour of one sample, without lighting.
 * @param landCover WorldCover class, or 0 when unknown.
 * @param isSea true where the elevation data says open sea.
 */
export function surfaceColour(metres: number, landCover: number, isSea: boolean): Rgb {
  if (isSea) return SEA_COLOUR;
  if (landCover === LAND_COVER.water) return FRESH_WATER_COLOUR;
  const byHeight = hypsometricColour(metres);
  const byCover = LAND_COVER_COLOUR[landCover];
  if (!byCover) return byHeight;
  // Snow and ice are shown as they are; everything else keeps a hint of elevation colour.
  const w = landCover === LAND_COVER.snow ? 1 : 0.68;
  return [byHeight[0] + (byCover[0] - byHeight[0]) * w, byHeight[1] + (byCover[1] - byHeight[1]) * w, byHeight[2] + (byCover[2] - byHeight[2]) * w];
}

// ---- Unity ----

/** 16-bit little-endian RAW heightmap (Unity Terrain import). Returns the bytes and the range used. */
export function toRaw16(heights: ArrayLike<number>): { bytes: Uint8Array; minMetres: number; maxMetres: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    min = Math.min(min, heights[i]!);
    max = Math.max(max, heights[i]!);
  }
  const span = max - min || 1;
  const bytes = new Uint8Array(heights.length * 2);
  for (let i = 0; i < heights.length; i++) {
    const v = Math.round(((heights[i]! - min) / span) * 65535);
    bytes[i * 2] = v & 0xff;
    bytes[i * 2 + 1] = v >> 8;
  }
  return { bytes, minMetres: min, maxMetres: max };
}
