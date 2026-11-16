import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Assets3dManifest, type ContentPack } from "@dunialab/content";
import {
  buildPlan,
  createAssetReader,
  DEFAULT_PARAMS,
  generatePack,
  haversineKm,
  isLfsPointer,
  lfsBytes,
  readLfsPointer,
  syntheticElevation,
  verifyAssets,
} from "../src/index.js";
import { chooseDem, copernicusTileName, linesNearPath, linesOf, worldCoverTileName } from "../src/remote.js";

const kenya = JSON.parse(readFileSync(new URL("../../../packages/content/packs/kenya-explorer.json", import.meta.url), "utf8")) as ContentPack;
const name = (en: string) => ({ en, sw: en });
const hill = (lon: number, lat: number) => (lon > 1.9 ? 0 : 50 + Math.max(0, 2000 - Math.hypot(lon - 1, lat - 1) * 4000) + (1.9 - lon) * 100);
const pack: ContentPack = {
  ...kenya,
  id: "zz.unit.hill",
  version: "1.2.3",
  printTarget: { ...kenya.printTarget, bounds: [[0.5, 0.5], [2, 1.5]] },
  features: [
    { id: "b-hill", kind: "mountain", name: name("Hill"), anchor: [1, 1], facts: [] },
    { id: "a-valley", kind: "valley", name: name("Valley"), anchor: [1.4, 1], facts: [] },
    { id: "c-town", kind: "city", name: name("Town"), anchor: [1.5, 1], facts: [] },
    { id: "d-coast", kind: "coast", name: name("Coast"), anchor: [1.9, 1], facts: [] },
    { id: "e-stream", kind: "river", name: name("Stream without a line"), anchor: [1.2, 1], facts: [] },
  ],
};

describe("buildPlan", () => {
  const plan = buildPlan(pack);

  it("derives zooms from the map size, not from a list of places", () => {
    expect(plan.overviewTiles.length).toBeLessThanOrEqual(DEFAULT_PARAMS.maxOverviewTiles);
    expect(plan.regionalZoom).toBe(plan.overviewZoom + DEFAULT_PARAMS.regionalZoomOffset);
    expect(plan.regionalTiles.length).toBeGreaterThan(plan.overviewTiles.length);
  });

  it("gives HD patches to the kinds that need close-ups, sized by kind, in a stable order", () => {
    expect(plan.patches.map((p) => [p.featureId, p.sizeKm])).toEqual([["a-valley", 60], ["b-hill", 40]]);
    const [[w, s], [e, n]] = plan.patches[1]!.bounds;
    expect(haversineKm([w, 1], [e, 1])).toBeCloseTo(40, 0);
    expect(haversineKm([1, s], [1, n])).toBeCloseTo(40, 0);
  });

  it("only traces rivers that have a line, and finds every lake", () => {
    expect(plan.rivers).toEqual([]);
    expect(plan.lakes).toEqual([]);
    expect(buildPlan(kenya).rivers.map((r) => r.featureId)).toEqual(["tana-river"]);
    expect(buildPlan(kenya).lakes.map((l) => l.featureId)).toEqual(["lake-turkana", "lake-victoria"]);
  });

  it("lets the kinds that get patches be changed by a parameter", () => {
    const custom = buildPlan(pack, { ...DEFAULT_PARAMS, patchKmByKind: { coast: 80 } });
    expect(custom.patches.map((p) => p.featureId)).toEqual(["d-coast"]);
  });
});

describe("generate, read back and verify", () => {
  let dir = "";
  let manifest: Assets3dManifest;
  const small = { heightSize: 33, textureSize: 32, regionalTextureSize: 32, patchHeightSize: 33, patchTextureSize: 64, regionalMetresPerPixel: 800 };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "dunialab-geo-unit-"));
    manifest = await generatePack({ pack, outDir: dir, sources: { elevation: syntheticElevation(hill) }, params: small });
  }, 120_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("produces identical files when run twice, so fingerprints are stable", async () => {
    const again = mkdtempSync(join(tmpdir(), "dunialab-geo-unit-2-"));
    try {
      const second = await generatePack({ pack, outDir: again, sources: { elevation: syntheticElevation(hill) }, params: small });
      expect(second.files).toEqual(manifest.files);
      expect(readFileSync(join(again, "manifest.json"), "utf8")).toBe(readFileSync(join(dir, "manifest.json"), "utf8"));
    } finally {
      rmSync(again, { recursive: true, force: true });
    }
  }, 120_000);

  it("does not store tiles that are entirely sea", () => {
    const plan = buildPlan(pack, { ...DEFAULT_PARAMS, ...small });
    expect(manifest.regional.tiles.length).toBeLessThan(plan.regionalTiles.length);
  });

  it("records what a learner downloads, and that figure matches the files", () => {
    const shipped = manifest.files.filter((f) => f.role !== "preview").reduce((sum, f) => sum + f.bytes, 0);
    const manifestBytes = Buffer.byteLength(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.delivery.pack3dTotalBytes).toBe(shipped + manifestBytes);
    expect(manifest.delivery.first3dOpenBytes).toBeLessThan(manifest.delivery.pack3dTotalBytes);
    expect(Object.keys(manifest.delivery.hdFeaturePatchBytes).sort()).toEqual(["a-valley", "b-hill"]);
  });

  it("reads heights back from the shipped files", async () => {
    const reader = createAssetReader(dir);
    const patch = await reader.patchHeights("b-hill");
    const centre = (patch.size * patch.size - 1) / 2;
    expect(haversineKm(patch.lonLatOf(centre), [1, 1])).toBeLessThan(0.5);
    expect(patch.data[centre]!).toBeGreaterThan(1900);
    expect(await reader.heightAt([1.98, 1])).toBe(0);
    expect(await reader.heightAt([50, 50])).toBe(0); // far outside: no tile, so sea
    await expect(reader.patchHeights("c-town")).rejects.toThrow(/no patch/);
  });

  it("accepts sound assets and names every kind of damage", async () => {
    expect(await verifyAssets(dir)).toEqual([]);

    const victim = manifest.files.find((f) => f.role === "patch")!;
    const original = readFileSync(join(dir, victim.path));
    writeFileSync(join(dir, victim.path), Buffer.concat([original, Buffer.from("x")]));
    const changed = await verifyAssets(dir);
    expect(changed.some((p) => p.includes(victim.path) && p.includes("bytes"))).toBe(true);
    expect(changed.some((p) => p.includes("fingerprint"))).toBe(true);

    unlinkSync(join(dir, victim.path));
    expect((await verifyAssets(dir)).some((p) => p.includes("missing"))).toBe(true);
    writeFileSync(join(dir, victim.path), original);

    writeFileSync(join(dir, "stray.txt"), "left behind");
    expect(await verifyAssets(dir)).toEqual(["stray.txt: on disk but not listed in the manifest"]);
    unlinkSync(join(dir, "stray.txt"));
    expect(await verifyAssets(dir)).toEqual([]);
  });

  it("verifies Git LFS pointers by the size and fingerprint they record, without the real file", async () => {
    const victim = manifest.files.find((f) => f.role === "regional-tile" && f.path.endsWith("h.webp"))!;
    const path = join(dir, victim.path);
    const original = readFileSync(path);
    const pointer = (sha: string, bytes: number) => `version https://git-lfs.github.com/spec/v1\noid sha256:${sha}\nsize ${bytes}\n`;

    writeFileSync(path, pointer(victim.sha256, victim.bytes));
    expect(isLfsPointer(path)).toBe(true);
    expect(readLfsPointer(path)).toEqual({ sha256: victim.sha256, bytes: victim.bytes });
    expect(await verifyAssets(dir)).toEqual([]);
    expect(lfsBytes(dir)).toBeGreaterThan(victim.bytes);

    writeFileSync(path, pointer("0".repeat(64), victim.bytes));
    expect((await verifyAssets(dir)).join("\n")).toMatch(/fingerprint/);

    writeFileSync(path, original);
    expect(isLfsPointer(path)).toBe(false);
    expect(readLfsPointer(path)).toBeNull();
  });

  it("reports a missing or malformed manifest instead of crashing", async () => {
    const empty = mkdtempSync(join(tmpdir(), "dunialab-geo-empty-"));
    try {
      expect((await verifyAssets(empty))[0]).toMatch(/missing/);
      writeFileSync(join(empty, "manifest.json"), JSON.stringify({ schemaVersion: 99 }));
      expect((await verifyAssets(empty)).length).toBeGreaterThan(0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("remote sources: names and choices", () => {
  it("names Copernicus files by their south-west corner", () => {
    expect(copernicusTileName(37, -1, 10)).toBe("Copernicus_DSM_COG_10_S01_00_E037_00_DEM");
    expect(copernicusTileName(-70, 42, 30)).toBe("Copernicus_DSM_COG_30_N42_00_W070_00_DEM");
    expect(copernicusTileName(0, 0, 30)).toBe("Copernicus_DSM_COG_30_N00_00_E000_00_DEM");
  });

  it("names WorldCover files by their south-west corner on the 3 degree grid", () => {
    expect(worldCoverTileName(36, -3)).toBe("ESA_WorldCover_10m_2021_v200_S03E036_Map");
    expect(worldCoverTileName(-72, 42)).toBe("ESA_WorldCover_10m_2021_v200_N42W072_Map");
  });

  it("uses the smallest elevation product that is detailed enough", () => {
    expect(chooseDem(185)).toMatchObject({ product: "GLO-90", level: 1 });
    expect(chooseDem(600)).toMatchObject({ product: "GLO-90", level: 2 });
    expect(chooseDem(92.8)).toMatchObject({ product: "GLO-90", level: 0 });
    expect(chooseDem(58.6)).toMatchObject({ product: "GLO-30", level: 1 });
    expect(chooseDem(39)).toMatchObject({ product: "GLO-30", level: 0 });
    expect(chooseDem(1)).toMatchObject({ product: "GLO-30", level: 0 });
  });

  it("reads lines out of GeoJSON, whatever the geometry type", () => {
    const lines = linesOf({
      features: [
        { geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
        { geometry: { type: "MultiLineString", coordinates: [[[2, 2], [3, 3]], [[4, 4], [5, 5]]] } },
        { geometry: { type: "Point", coordinates: [9, 9] } },
        { geometry: null },
      ],
    });
    expect(lines).toHaveLength(3);
  });

  it("keeps surveyed lines that run along the rough line and drops ones that only cross it", () => {
    const rough: [number, number][] = [[0, 0], [2, 0]];
    const along: [number, number][] = [[0, 0.05], [1, 0.1], [2, 0.05]];
    const crossing: [number, number][] = [[1, -3], [1, -2], [1, -1], [1, 0], [1, 1], [1, 2], [1, 3]];
    const farAway: [number, number][] = [[40, 40], [41, 41]];
    expect(linesNearPath([along, crossing, farAway, [[0, 0]]], rough, 30)).toEqual([along]);
  });
});
