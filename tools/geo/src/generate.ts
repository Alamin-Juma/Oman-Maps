/**
 * The generator: one content pack in, its 3D assets out (ADR-0009).
 *
 *   pack bounds + features  ->  elevation (+ land cover, + surveyed river lines)
 *     -> rivers traced, lakes found
 *     -> country overview tiles, regional tiles, HD patches (heights + baked colour + baked light)
 *     -> rivers.json, lakes.json, previews for a human, manifest.json with a fingerprint per file
 *
 * It depends on data-source ports (plan.ts), so tests run it on formula terrain with no
 * network. It never names a pack, a feature or a place.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ASSETS3D_SCHEMA_VERSION,
  Assets3dManifest,
  tilePath,
  type AssetFile,
  type AssetSource,
  type ContentPack,
  type LakeSummary,
  type LakesFile,
  type RiverSummary,
  type RiversFile,
  type TerrainPatch,
} from "@dunialab/content";
import { bakeShade, LAND_COVER, surfaceColour } from "./bake.js";
import {
  KM_PER_DEG_LAT,
  expandBounds,
  kmPerDegLon,
  tileBounds,
  tileMetresPerPixel,
  tileXToLon,
  tileYToLat,
  type Bounds,
  type LonLat,
} from "./geo-math.js";
import { cellOf, mipChain, pickLevel, sample, type GeoGrid } from "./grid.js";
import { carveChannel, traceRiver, type TracedRiver } from "./hydro.js";
import { greyWebp, heightWebp, previewJpeg, rgbWebp, sha256 } from "./images.js";
import { detectLake, type DetectedLake } from "./lakes.js";
import { DEFAULT_PARAMS, buildPlan, type GeoParams, type GeoSources, type PatchPlan } from "./plan.js";

export const GENERATOR = { name: "@dunialab/geo", version: "0.2.0" } as const;
const SEA_LEVEL = 0.01;
const SHADE_MARGIN = 4;

export interface GenerateOptions {
  pack: ContentPack;
  /** Folder that will hold manifest.json (normally content-assets/<packId>/3d). It is replaced. */
  outDir: string;
  sources: GeoSources;
  params?: Partial<GeoParams>;
  log?: (message: string) => void;
}

export async function generatePack(o: GenerateOptions): Promise<Assets3dManifest> {
  const params: GeoParams = { ...DEFAULT_PARAMS, ...o.params };
  const log = o.log ?? (() => {});
  const { pack, outDir, sources } = o;
  const plan = buildPlan(pack, params);
  const flags: { id: string; message: string }[] = [
    {
      id: "borders-not-baked",
      message:
        "Country borders are not drawn into the terrain images. The viewer draws them from the same Natural Earth data as the 2D map. A teacher must review how disputed borders are shown.",
    },
    {
      id: "heights-for-drawing-only",
      message: "Elevations and lengths in these files are for drawing. Numbers shown to children come from the pack's approved facts.",
    },
  ];

  for (const sub of ["tiles", "patches", "previews", "manifest.json", "rivers.json", "lakes.json"]) rmSync(join(outDir, sub), { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const files: AssetFile[] = [];
  const write = (path: string, bytes: Uint8Array, role: AssetFile["role"], from: AssetSource[]) => {
    const target = join(outDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    files.push({ path, bytes: bytes.length, sha256: sha256(bytes), role, sources: from.map((s) => s.id) });
  };

  // ---- 1. regional data for the whole map ----
  log(`reading elevation for ${pack.id} at ~${params.regionalMetresPerPixel} m per pixel`);
  const dataBounds = expandBounds(plan.bounds, params.marginDeg);
  const dem = await sources.elevation.read(dataBounds, params.regionalMetresPerPixel);
  const cover = sources.landCover ? await sources.landCover.read(dataBounds, params.regionalMetresPerPixel) : null;

  // ---- 2. rivers (traced before tiles, so their channels are cut into the terrain) ----
  const rivers: { featureId: string; traced: TracedRiver; guides: LonLat[][]; roughPath: LonLat[] }[] = [];
  let guidesUsed = false;
  for (const r of plan.rivers) {
    const guides = sources.guideRivers ? await sources.guideRivers.linesNear(r.roughPath, params.guideSearchKm) : [];
    let traced: TracedRiver;
    try {
      traced = traceRiver({ dem, roughPath: r.roughPath, guides });
    } catch (error) {
      throw new Error(`river "${r.featureId}": ${error instanceof Error ? error.message : String(error)}`);
    }
    if (guides.length) guidesUsed = true;
    else flags.push({ id: `river-unguided:${r.featureId}`, message: "No surveyed line was found near this river; its course comes from elevation data and the pack's rough line only. Check the preview carefully." });
    flags.push({ id: `river-course:${r.featureId}`, message: `Traced course, ${traced.lengthKm} km. Compare previews/river-${r.featureId}.jpg with a trusted map before approval.` });
    carveChannel(dem, traced.points, 1);
    rivers.push({ featureId: r.featureId, traced, guides, roughPath: r.roughPath });
    log(`river ${r.featureId}: ${traced.lengthKm} km, ends in ${traced.endsIn}${traced.guided ? `, up to ${traced.maxOffGuideKm} km from the guide` : ", unguided"}`);
  }

  // ---- 3. lakes ----
  const lakes: { featureId: string; lake: DetectedLake }[] = [];
  for (const l of plan.lakes) {
    const lake = detectLake(dem, l.anchor);
    if (!lake) {
      flags.push({ id: `lake-not-found:${l.featureId}`, message: "No flat water surface was found at this lake's anchor in the elevation data. Check the anchor point." });
      continue;
    }
    lakes.push({ featureId: l.featureId, lake });
    log(`lake ${l.featureId}: surface ${lake.surfaceMetres} m, ${lake.areaKm2} km2${lake.clippedByMap ? " (continues beyond the map)" : ""}`);
  }

  // ---- 4. surface colour for the whole map, then coarser copies for clean shrinking ----
  const colour = colourGrids(dem, cover);
  const demLevels = mipChain(dem);
  const colourLevels = colour.map((c) => mipChain(c));
  const elevationSources = () => sources.elevation.used();
  const coverSources = () => sources.landCover?.used() ?? [];

  // ---- 5. tiles ----
  // Overview: everything from the whole-map data, averaged down.
  const overviewTiles: { x: number; y: number }[] = [];
  for (const { x, y } of plan.overviewTiles) {
    const z = plan.overviewZoom;
    const heights = tileHeights(z, x, y, params.heightSize, demLevels);
    if (!heights) continue; // open sea: nothing to store
    const ts = params.textureSize;
    const tex = tileTexturesFromMap(z, x, y, ts, demLevels, colourLevels, params.shadeZFactor.overview);
    overviewTiles.push({ x, y });
    write(tilePath(z, x, y, "h"), await heightWebp(heights, params.heightSize, params.heightSize, params.heightStepMetres), "overview-tile", elevationSources());
    write(tilePath(z, x, y, "albedo"), await rgbWebp(tex.albedo, ts, ts, params.albedoQuality), "overview-tile", [...elevationSources(), ...coverSources()]);
    write(tilePath(z, x, y, "shade"), await greyWebp(tex.shade, ts, ts, params.shadeQuality), "overview-tile", elevationSources());
  }
  log(`overview: zoom ${plan.overviewZoom}, ${overviewTiles.length} tiles`);

  // Regional: the mesh heights come from the whole-map data (so neighbouring tiles meet
  // exactly); the colour and light are baked from a finer window read for that tile alone.
  const regionalTiles: { x: number; y: number }[] = [];
  for (const { x, y } of plan.regionalTiles) {
    const z = plan.regionalZoom;
    const heights = tileHeights(z, x, y, params.heightSize, demLevels);
    if (!heights) continue;
    const ts = params.regionalTextureSize;
    const [[tw, tsouth], [te, tn]] = tileBounds(z, x, y);
    const metresPerPixel = tileMetresPerPixel(z, tileYToLat(y + 0.5, z), ts);
    const marginDeg = ((te - tw) / ts) * (SHADE_MARGIN + 2);
    const readBounds: Bounds = [[tw - marginDeg, tsouth - marginDeg], [te + marginDeg, tn + marginDeg]];
    const tileDem = await sources.elevation.read(readBounds, metresPerPixel);
    for (const r of rivers) carveChannel(tileDem, r.traced.points, 1);
    const tileCover = sources.landCover ? await sources.landCover.read(readBounds, metresPerPixel) : null;
    const tex = bakeTextures(ts, (px, py) => [tileXToLon(x + px / ts, z), tileYToLat(y + py / ts, z)], tileDem, tileCover, metresPerPixel, params.shadeZFactor.regional);
    regionalTiles.push({ x, y });
    write(tilePath(z, x, y, "h"), await heightWebp(heights, params.heightSize, params.heightSize, params.heightStepMetres), "regional-tile", elevationSources());
    write(tilePath(z, x, y, "albedo"), await rgbWebp(tex.albedo, ts, ts, params.albedoQuality), "regional-tile", [...elevationSources(), ...coverSources()]);
    write(tilePath(z, x, y, "shade"), await greyWebp(tex.shade, ts, ts, params.shadeQuality), "regional-tile", elevationSources());
    if (regionalTiles.length % 10 === 0) log(`  regional tiles: ${regionalTiles.length} written`);
  }
  log(`regional: zoom ${plan.regionalZoom}, ${regionalTiles.length} tiles`);

  // ---- 6. HD patches ----
  const patches: TerrainPatch[] = [];
  const patchPreviews: { plan: PatchPlan; rgb: Uint8Array }[] = [];
  for (const p of plan.patches) {
    log(`patch ${p.featureId} (${p.kind}, ${p.sizeKm} km)`);
    const metresPerPixel = (p.sizeKm * 1000) / params.patchTextureSize;
    const marginDeg = ((SHADE_MARGIN + 2) * metresPerPixel) / 1000 / (KM_PER_DEG_LAT * Math.max(0.2, Math.cos((p.centre[1] * Math.PI) / 180)));
    const readBounds = expandBounds(p.bounds, marginDeg);
    const patchDem = await sources.elevation.read(readBounds, metresPerPixel);
    for (const r of rivers) carveChannel(patchDem, r.traced.points, 1);
    const patchCover = sources.landCover ? await sources.landCover.read(readBounds, metresPerPixel) : null;
    const rendered = renderPatch(p, params, patchDem, patchCover, metresPerPixel);
    const dir = `patches/${p.featureId}`;
    const from = [...elevationSources(), ...coverSources()];
    write(`${dir}/h.webp`, await heightWebp(rendered.heights, params.patchHeightSize, params.patchHeightSize, params.heightStepMetres), "patch", elevationSources());
    write(`${dir}/albedo.webp`, await rgbWebp(rendered.albedo, params.patchTextureSize, params.patchTextureSize, params.albedoQuality), "patch", from);
    write(`${dir}/shade.webp`, await greyWebp(rendered.shade, params.patchTextureSize, params.patchTextureSize, params.shadeQuality), "patch", elevationSources());
    patches.push({
      featureId: p.featureId,
      kind: p.kind,
      bounds: roundBounds(p.bounds),
      sizeKm: p.sizeKm,
      heightSize: params.patchHeightSize,
      textureSize: params.patchTextureSize,
      dir,
      elevationRange: rendered.range,
    });
    patchPreviews.push({ plan: p, rgb: lit(rendered.albedo, rendered.shade) });
  }

  // ---- 7. rivers.json and lakes.json ----
  const guideSources = guidesUsed ? (sources.guideRivers?.used() ?? []) : [];
  const riversFile: RiversFile = { schemaVersion: ASSETS3D_SCHEMA_VERSION, rivers: rivers.map((r) => ({ featureId: r.featureId, points: r.traced.points })) };
  const lakesFile: LakesFile = {
    schemaVersion: ASSETS3D_SCHEMA_VERSION,
    lakes: lakes.map((l) => ({ featureId: l.featureId, surfaceMetres: l.lake.surfaceMetres, outline: l.lake.outline })),
  };
  write("rivers.json", Buffer.from(JSON.stringify(riversFile)), "manifest-data", [...elevationSources(), ...guideSources]);
  write("lakes.json", Buffer.from(JSON.stringify(lakesFile)), "manifest-data", elevationSources());

  // ---- 8. previews for the human checkpoint (not downloaded by learners) ----
  const sampleColour = (lon: number, lat: number, cellDeg: number): [number, number, number] => [
    sample(pickLevel(colourLevels[0]!, cellDeg), lon, lat),
    sample(pickLevel(colourLevels[1]!, cellDeg), lon, lat),
    sample(pickLevel(colourLevels[2]!, cellDeg), lon, lat),
  ];
  const mapPreview = async (name: string, bounds: Bounds, title: string, zFactor: number) => {
    const { rgb, width, height } = renderMap(bounds, 1400, demLevels, sampleColour, zFactor);
    const svg = overlaySvg({ bounds, width, height, title, pack, rivers, lakes, patches: plan.patches });
    write(`previews/${name}.jpg`, await previewJpeg(rgb, width, height, svg), "preview", []);
  };
  await mapPreview("overview", plan.bounds, `${pack.title.en}: whole map`, params.shadeZFactor.overview);
  for (const r of rivers) {
    const b = expandBounds(boundsOf(r.traced.points.map((p): LonLat => [p[0], p[1]])), 0.35);
    await mapPreview(`river-${r.featureId}`, b, `River ${r.featureId}: blue = traced, pink = surveyed guide, black = pack's rough line`, params.shadeZFactor.regional);
  }
  for (const l of lakes) {
    const b = expandBounds(boundsOf(l.lake.outline), 0.3);
    await mapPreview(`lake-${l.featureId}`, b, `Lake ${l.featureId}: surface ${l.lake.surfaceMetres} m, ${l.lake.areaKm2} km2 inside the map`, params.shadeZFactor.regional);
  }
  for (const p of patchPreviews) {
    const size = params.patchTextureSize;
    const patch = patches.find((x) => x.featureId === p.plan.featureId)!;
    const svg = overlaySvg({
      bounds: p.plan.bounds,
      width: size,
      height: size,
      title: `HD patch ${p.plan.featureId} (${p.plan.sizeKm} km): data range ${Math.round(patch.elevationRange[0])} to ${Math.round(patch.elevationRange[1])} m`,
      pack,
      rivers,
      lakes: [],
      patches: [],
    });
    write(`previews/patch-${p.plan.featureId}.jpg`, await previewJpeg(p.rgb, size, size, svg), "preview", []);
  }

  // ---- 9. manifest ----
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const shipped = files.filter((f) => f.role !== "preview");
  const sum = (list: AssetFile[]) => list.reduce((total, f) => total + f.bytes, 0);
  const sourcesUsed = dedupe([...elevationSources(), ...coverSources(), ...guideSources]);
  const riverItems: RiverSummary[] = rivers.map((r) => ({
    featureId: r.featureId,
    lengthKm: r.traced.lengthKm,
    points: r.traced.points.length,
    endsIn: r.traced.endsIn,
    guided: r.traced.guided,
    maxOffGuideKm: r.traced.maxOffGuideKm,
    sourceElevation: r.traced.points[0]![2],
  }));
  const lakeItems: LakeSummary[] = lakes.map((l) => ({ featureId: l.featureId, surfaceMetres: l.lake.surfaceMetres, areaKm2: l.lake.areaKm2, clippedByMap: l.lake.clippedByMap }));

  const build = (manifestBytes: number): Assets3dManifest => ({
    schemaVersion: ASSETS3D_SCHEMA_VERSION,
    packId: pack.id,
    packVersion: pack.version,
    generator: { ...GENERATOR },
    bounds: plan.bounds,
    encoding: {
      height: "terrain-rgb/webp-lossless",
      heightStepMetres: params.heightStepMetres,
      albedo: "rgb/webp",
      shade: "grey/webp",
      tiles: "xyz-web-mercator",
      patches: "equirectangular",
    },
    overview: { zoom: plan.overviewZoom, heightSize: params.heightSize, textureSize: params.textureSize, tiles: overviewTiles },
    regional: { zoom: plan.regionalZoom, heightSize: params.heightSize, textureSize: params.regionalTextureSize, tiles: regionalTiles },
    patches,
    rivers: { file: "rivers.json", items: riverItems },
    lakes: { file: "lakes.json", items: lakeItems },
    sources: sourcesUsed,
    files,
    delivery: {
      first3dOpenBytes: manifestBytes + sum(shipped.filter((f) => f.role === "overview-tile" || f.role === "manifest-data")),
      pack3dTotalBytes: manifestBytes + sum(shipped),
      hdFeaturePatchBytes: Object.fromEntries(patches.map((p) => [p.featureId, sum(shipped.filter((f) => f.path.startsWith(`${p.dir}/`)))])),
    },
    review: { status: "draft", flags },
  });
  // The manifest's own size is part of what is downloaded; measure it, then write it.
  const serialise = (m: Assets3dManifest) => `${JSON.stringify(m, null, 1)}\n`;
  // (Its size appears inside it, so repeat until the number stops changing.)
  let manifestBytes = 0;
  for (let i = 0; i < 5; i++) {
    const next = Buffer.byteLength(serialise(build(manifestBytes)));
    if (next === manifestBytes) break;
    manifestBytes = next;
  }
  const manifest = Assets3dManifest.parse(build(manifestBytes));
  writeFileSync(join(outDir, "manifest.json"), serialise(manifest));
  log(`done: ${files.length} files, ${(manifest.delivery.pack3dTotalBytes / 1e6).toFixed(2)} MB shipped, first 3D open ${(manifest.delivery.first3dOpenBytes / 1e6).toFixed(2)} MB`);
  return manifest;
}

// ---- rendering ----

type Levels<T extends Float32Array | Uint8Array> = GeoGrid<T>[];

/** Surface colour of every cell of the regional data, as three byte grids (R, G, B). */
function colourGrids(dem: GeoGrid, cover: GeoGrid<Uint8Array> | null): [GeoGrid<Uint8Array>, GeoGrid<Uint8Array>, GeoGrid<Uint8Array>] {
  const n = dem.width * dem.height;
  const make = (): GeoGrid<Uint8Array> => ({ width: dem.width, height: dem.height, west: dem.west, north: dem.north, cell: dem.cell, data: new Uint8Array(n) });
  const [r, g, b] = [make(), make(), make()];
  for (let j = 0; j < dem.height; j++) {
    const lat = dem.north - (j + 0.5) * dem.cell;
    for (let i = 0; i < dem.width; i++) {
      const c = j * dem.width + i;
      const h = dem.data[c]!;
      const cls = cover ? coverAt(cover, dem.west + (i + 0.5) * dem.cell, lat) : LAND_COVER.noData;
      const rgb = surfaceColour(h, cls, isSea(h, cls));
      r.data[c] = rgb[0];
      g.data[c] = rgb[1];
      b.data[c] = rgb[2];
    }
  }
  return [r, g, b];
}

const isSea = (metres: number, cover: number) => metres <= SEA_LEVEL && (cover === LAND_COVER.noData || cover === LAND_COVER.water);

function coverAt(cover: GeoGrid<Uint8Array>, lon: number, lat: number): number {
  const [i, j] = cellOf(cover, [lon, lat]);
  return cover.data[j * cover.width + i]!;
}

/** Mesh heights of one tile from the whole-map data, or null when the tile is open sea. */
function tileHeights(z: number, x: number, y: number, hs: number, demLevels: Levels<Float32Array>): Float32Array | null {
  const [[west], [east]] = tileBounds(z, x, y);
  const level = pickLevel(demLevels, (east - west) / (hs - 1));
  const heights = new Float32Array(hs * hs);
  let highest = -Infinity;
  for (let r = 0; r < hs; r++) {
    const lat = tileYToLat(y + r / (hs - 1), z);
    for (let c = 0; c < hs; c++) {
      const h = sample(level, tileXToLon(x + c / (hs - 1), z), lat);
      heights[r * hs + c] = h;
      if (h > highest) highest = h;
    }
  }
  return highest <= SEA_LEVEL ? null : heights;
}

/** Colour and baked light of one tile from the whole-map data, averaged down to the tile's detail. */
function tileTexturesFromMap(z: number, x: number, y: number, ts: number, demLevels: Levels<Float32Array>, colourLevels: Levels<Uint8Array>[], zFactor: number) {
  const [[west], [east]] = tileBounds(z, x, y);
  const cellDeg = (east - west) / ts;
  const full = ts + 2 * SHADE_MARGIN;
  const detail = new Float32Array(full * full);
  const detailLevel = pickLevel(demLevels, cellDeg);
  const [rL, gL, bL] = colourLevels.map((levels) => pickLevel(levels, cellDeg)) as [GeoGrid<Uint8Array>, GeoGrid<Uint8Array>, GeoGrid<Uint8Array>];
  const albedo = new Uint8Array(ts * ts * 3);
  for (let r = -SHADE_MARGIN; r < ts + SHADE_MARGIN; r++) {
    const lat = tileYToLat(y + (r + 0.5) / ts, z);
    for (let c = -SHADE_MARGIN; c < ts + SHADE_MARGIN; c++) {
      const lon = tileXToLon(x + (c + 0.5) / ts, z);
      detail[(r + SHADE_MARGIN) * full + (c + SHADE_MARGIN)] = sample(detailLevel, lon, lat);
      if (r >= 0 && c >= 0 && r < ts && c < ts) {
        const k = (r * ts + c) * 3;
        albedo[k] = sample(rL, lon, lat);
        albedo[k + 1] = sample(gL, lon, lat);
        albedo[k + 2] = sample(bL, lon, lat);
      }
    }
  }
  const shade = bakeShade(detail, ts, ts, SHADE_MARGIN, { metresPerPixel: tileMetresPerPixel(z, tileYToLat(y + 0.5, z), ts), zFactor });
  return { albedo, shade };
}

/**
 * Colour and baked light for a `ts` x `ts` image from data read for that area alone.
 * `at(px, py)` gives the longitude/latitude of a position in pixels (0..ts across the image).
 */
function bakeTextures(
  ts: number,
  at: (px: number, py: number) => LonLat,
  dem: GeoGrid,
  cover: GeoGrid<Uint8Array> | null,
  metresPerPixel: number,
  zFactor: number,
) {
  const full = ts + 2 * SHADE_MARGIN;
  const detail = new Float32Array(full * full);
  const albedo = new Uint8Array(ts * ts * 3);
  for (let r = -SHADE_MARGIN; r < ts + SHADE_MARGIN; r++) {
    for (let c = -SHADE_MARGIN; c < ts + SHADE_MARGIN; c++) {
      const [lon, lat] = at(c + 0.5, r + 0.5);
      const h = sample(dem, lon, lat);
      detail[(r + SHADE_MARGIN) * full + (c + SHADE_MARGIN)] = h;
      if (r >= 0 && c >= 0 && r < ts && c < ts) {
        const cls = cover ? coverAt(cover, lon, lat) : LAND_COVER.noData;
        const rgb = surfaceColour(h, cls, isSea(h, cls));
        const k = (r * ts + c) * 3;
        albedo[k] = rgb[0];
        albedo[k + 1] = rgb[1];
        albedo[k + 2] = rgb[2];
      }
    }
  }
  return { albedo, shade: bakeShade(detail, ts, ts, SHADE_MARGIN, { metresPerPixel, zFactor }) };
}

function renderPatch(p: PatchPlan, params: GeoParams, dem: GeoGrid, cover: GeoGrid<Uint8Array> | null, metresPerPixel: number) {
  const hs = params.patchHeightSize;
  const ts = params.patchTextureSize;
  const [[w, s], [e, n]] = p.bounds;
  const heightLevel = pickLevel(mipChain(dem, 8), (e - w) / (hs - 1));
  const heights = new Float32Array(hs * hs);
  let low = Infinity;
  let high = -Infinity;
  for (let r = 0; r < hs; r++) {
    const lat = n - (r / (hs - 1)) * (n - s);
    for (let c = 0; c < hs; c++) {
      const h = sample(heightLevel, w + (c / (hs - 1)) * (e - w), lat);
      heights[r * hs + c] = h;
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
  }
  const tex = bakeTextures(ts, (px, py) => [w + (px / ts) * (e - w), n - (py / ts) * (n - s)], dem, cover, metresPerPixel, params.shadeZFactor.patch);
  return { heights, ...tex, range: [Math.round(low * 10) / 10, Math.round(high * 10) / 10] as [number, number] };
}

/** Colour multiplied by baked light: what the terrain looks like. */
function lit(albedo: Uint8Array, shade: Uint8Array): Uint8Array {
  const out = new Uint8Array(albedo.length);
  for (let i = 0; i < shade.length; i++) {
    const light = (shade[i]! / 255) * 1.18;
    out[i * 3] = Math.min(255, albedo[i * 3]! * light);
    out[i * 3 + 1] = Math.min(255, albedo[i * 3 + 1]! * light);
    out[i * 3 + 2] = Math.min(255, albedo[i * 3 + 2]! * light);
  }
  return out;
}

/** A lit picture of any part of the map, north up, in plain longitude/latitude. */
function renderMap(
  bounds: Bounds,
  width: number,
  demLevels: Levels<Float32Array>,
  colourAt: (lon: number, lat: number, cellDeg: number) => [number, number, number],
  zFactor: number,
) {
  const [[w, s], [e, n]] = bounds;
  const midLat = (s + n) / 2;
  const height = Math.max(1, Math.round((width * (n - s) * KM_PER_DEG_LAT) / ((e - w) * kmPerDegLon(midLat))));
  const cellX = (e - w) / width;
  const cellY = (n - s) / height;
  const level = pickLevel(demLevels, cellX);
  const M = 3;
  const fullW = width + 2 * M;
  const detail = new Float32Array(fullW * (height + 2 * M));
  const albedo = new Uint8Array(width * height * 3);
  for (let r = -M; r < height + M; r++) {
    const lat = n - (r + 0.5) * cellY;
    for (let c = -M; c < width + M; c++) {
      const lon = w + (c + 0.5) * cellX;
      detail[(r + M) * fullW + (c + M)] = sample(level, lon, lat);
      if (r >= 0 && c >= 0 && r < height && c < width) albedo.set(colourAt(lon, lat, cellX), (r * width + c) * 3);
    }
  }
  const shade = bakeShade(detail, width, height, M, { metresPerPixel: cellX * kmPerDegLon(midLat) * 1000, zFactor });
  return { rgb: lit(albedo, shade), width, height };
}

interface OverlayInput {
  bounds: Bounds;
  width: number;
  height: number;
  title: string;
  pack: ContentPack;
  rivers: { featureId: string; traced: TracedRiver; guides: LonLat[][]; roughPath: LonLat[] }[];
  lakes: { featureId: string; lake: DetectedLake }[];
  patches: PatchPlan[];
}

/** Lines and labels drawn over a preview, as SVG. Names come from the pack. */
function overlaySvg(o: OverlayInput): string {
  const [[w, s], [e, n]] = o.bounds;
  const px = ([lon, lat]: readonly [number, number]) => `${(((lon - w) / (e - w)) * o.width).toFixed(1)},${(((n - lat) / (n - s)) * o.height).toFixed(1)}`;
  const line = (points: readonly (readonly [number, number])[], style: string) => `<polyline fill="none" points="${points.map(px).join(" ")}" ${style}/>`;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const text = (x: number, y: number, t: string, size: number) =>
    `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="bold" fill="#111" stroke="#fff" stroke-width="${size / 4}" paint-order="stroke" stroke-linejoin="round">${esc(t)}</text>`;
  const parts: string[] = [];
  for (const p of o.patches) {
    const [[pw, ps], [pe, pn]] = p.bounds;
    parts.push(line([[pw, pn], [pe, pn], [pe, ps], [pw, ps], [pw, pn]], `stroke="#fff" stroke-width="2" stroke-dasharray="7 5"`));
  }
  for (const l of o.lakes) parts.push(line(l.lake.outline, `stroke="#00e5ff" stroke-width="2"`));
  for (const r of o.rivers) {
    for (const g of r.guides) parts.push(line(g, `stroke="#ff2fa0" stroke-width="2" stroke-dasharray="8 6"`));
    parts.push(line(r.roughPath, `stroke="#111" stroke-width="1.5" stroke-dasharray="3 5"`));
    const course = r.traced.points.map((p): [number, number] => [p[0], p[1]]);
    parts.push(line(course, `stroke="#fff" stroke-width="5" stroke-linejoin="round"`));
    parts.push(line(course, `stroke="#0b5fff" stroke-width="2.5" stroke-linejoin="round"`));
    const [sx, sy] = px(course[0]!).split(",");
    const [mx, my] = px(course.at(-1)!).split(",");
    parts.push(`<circle cx="${sx}" cy="${sy}" r="6" fill="#19c519" stroke="#fff" stroke-width="2"/><circle cx="${mx}" cy="${my}" r="6" fill="#e02020" stroke="#fff" stroke-width="2"/>`);
  }
  for (const f of o.pack.features) {
    const [lon, lat] = f.anchor;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    const [x, y] = px([lon, lat]).split(",").map(Number) as [number, number];
    parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="#111" stroke-width="1.5"/>`);
    parts.push(text(x + 8, y + 5, f.name.en, 16));
  }
  parts.push(text(12, 26, o.title, 19));
  parts.push(text(12, o.height - 12, "Preview for review only. Green dot = river start, red dot = river end.", 14));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}">${parts.join("")}</svg>`;
}

// ---- small helpers ----

function boundsOf(points: readonly LonLat[]): Bounds {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [[w, s], [e, n]];
}

const roundBounds = (b: Bounds): Bounds => [
  [Math.round(b[0][0] * 1e6) / 1e6, Math.round(b[0][1] * 1e6) / 1e6],
  [Math.round(b[1][0] * 1e6) / 1e6, Math.round(b[1][1] * 1e6) / 1e6],
];

function dedupe(sources: AssetSource[]): AssetSource[] {
  const seen = new Map<string, AssetSource>();
  for (const s of sources) if (!seen.has(s.id)) seen.set(s.id, s);
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
}
