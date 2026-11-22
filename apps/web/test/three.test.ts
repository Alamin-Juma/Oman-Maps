import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Assets3dManifest, validatePack, type ContentPack } from "@dunialab/content";
import { haversineKm, latToTileY, localFrame, lonToTileX, tileXToLon, tileYToLat, type LonLat } from "../src/three/geo.js";
import { chooseTier, has3d, plannedFiles, planScene, supports3d, tileBounds, waterFilesToLoad } from "../src/three/plan.js";
import { buildGrid, buildRibbon, decodeHeights, lakeShapePoints, sampleGrid } from "../src/three/terrain.js";

const pack = validatePack(JSON.parse(readFileSync(new URL("../../../packages/content/packs/kenya-explorer.json", import.meta.url), "utf8"))).pack!;
const manifest = Assets3dManifest.parse(
  JSON.parse(readFileSync(new URL(`../../../content-assets/${pack.id}/3d/manifest.json`, import.meta.url), "utf8")),
);
const base = { pack, manifest, tier: "medium" as const, reducedMotion: false };

describe("geo", () => {
  it("round-trips tiles and the local frame", () => {
    expect(tileXToLon(lonToTileX(37.3, 8), 8)).toBeCloseTo(37.3, 9);
    expect(tileYToLat(latToTileY(-0.15, 8), 8)).toBeCloseTo(-0.15, 9);
    const f = localFrame([37, 0]);
    expect(f.toLocal([37, 0])).toEqual([0, -0]);
    const [x, z] = f.toLocal([37.1, 0.1]);
    expect(x).toBeCloseTo(11.13, 1);
    expect(z).toBeCloseTo(-11.06, 1); // north is negative z
    const back = f.toLonLat(x, z);
    expect(back[0]).toBeCloseTo(37.1, 9);
    expect(back[1]).toBeCloseTo(0.1, 9);
  });

  it("measures distances", () => {
    expect(haversineKm([37, 0], [37, 1])).toBeCloseTo(111.2, 0);
  });
});

describe("device", () => {
  it("offers 3D only with WebGL2 and more than 1 GB of memory", () => {
    expect(supports3d({ webgl2: true, deviceMemoryGB: 1 })).toBe(false);
    expect(supports3d({ webgl2: true, deviceMemoryGB: 2 })).toBe(true);
    expect(supports3d({ webgl2: false })).toBe(false);
  });

  it("picks a tier from memory, defaulting to medium when the browser does not say", () => {
    expect(chooseTier({ webgl2: true })).toBe("medium");
    expect(chooseTier({ webgl2: true, deviceMemoryGB: 0.5 })).toBe("low");
    expect(chooseTier({ webgl2: true, deviceMemoryGB: 3 })).toBe("low");
    expect(chooseTier({ webgl2: true, deviceMemoryGB: 8 })).toBe("high");
  });

  it("has no 3D for map elements only", () => {
    for (const f of pack.features) expect(has3d(f)).toBe(f.kind !== "map-element");
  });
});

describe("planScene", () => {
  it("refuses unknown features and map elements", () => {
    expect(() => planScene({ ...base, featureId: "nowhere" })).toThrow(/no feature/);
    const withElement: ContentPack = {
      ...pack,
      features: [...pack.features, { id: "the-key", kind: "map-element", name: { en: "Key", sw: "Ufunguo" }, anchor: [37, 0], facts: [] }],
    };
    expect(() => planScene({ ...base, pack: withElement, featureId: "the-key" })).toThrow(/no 3D/);
  });

  it("falls back to a regional view for a kind without patches, at the minimum radius", () => {
    const plan = planScene({ ...base, featureId: "nairobi" });
    expect(plan.mode).toBe("region");
    expect(plan.patch).toBeNull();
    expect(plan.camera.distanceKm).toBeCloseTo(60 * 2.1, 5);
    expect(plan.labels.some((l) => l.featureId === "nairobi")).toBe(true);
  });

  it("caps regional tiles by tier and keeps the nearest", () => {
    const low = planScene({ ...base, tier: "low", featureId: "lake-victoria" });
    const high = planScene({ ...base, tier: "high", featureId: "lake-victoria" });
    expect(low.tiles.length).toBeLessThanOrEqual(4);
    expect(high.tiles.length).toBeGreaterThanOrEqual(low.tiles.length);
    // Every low-tier tile is also in the high-tier set (nearest first).
    for (const t of low.tiles) expect(high.tiles).toContainEqual(t);
    // The first tile contains the lake's anchor... or is the nearest land tile to it.
    const [[w, s], [e, n]] = tileBounds(low.tiles[0]!);
    const anchor = pack.features.find((f) => f.id === "lake-victoria")!.anchor;
    expect(Math.min(Math.abs(anchor[0] - (w + e) / 2), 3)).toBeLessThan(3);
    expect(s).toBeLessThan(n);
  });

  it("uses lighter meshes on lower tiers", () => {
    expect(planScene({ ...base, tier: "high", featureId: "mount-kenya" }).meshStride).toBe(1);
    expect(planScene({ ...base, tier: "medium", featureId: "mount-kenya" }).meshStride).toBe(2);
    expect(planScene({ ...base, tier: "low", featureId: "mount-kenya" }).meshStride).toBe(4);
  });

  it("lists the files to fetch: patch images, tiles, and the JSON only when needed", () => {
    const patch = planScene({ ...base, featureId: "mount-kenya" });
    expect(plannedFiles(patch, manifest).slice(0, 3)).toEqual([
      "patches/mount-kenya/h.webp",
      "patches/mount-kenya/albedo.webp",
      "patches/mount-kenya/shade.webp",
    ]);
    const overview = planScene({ ...base, featureId: null });
    const files = plannedFiles(overview, manifest);
    expect(files).toContain("lakes.json");
    expect(files).toContain("rivers.json");
    expect(files.filter((f) => f.startsWith("tiles/")).length).toBe(manifest.overview.tiles.length * 3);
  });

  it("titles the whole-map view with the pack's title and has no facts", () => {
    const plan = planScene({ ...base, featureId: null });
    expect(plan.title).toEqual(pack.title);
    expect(plan.facts).toEqual([]);
  });
});

describe("terrain arrays", () => {
  const frame = localFrame([0.5, 0.5]);
  const size = 5;
  const heights = Float32Array.from({ length: size * size }, (_, i) => i * 100);
  const grid = (stride: number, withSkirt: boolean) =>
    buildGrid({ heights, size, stride, withSkirt, toLocal: frame.toLocal, lonLatAt: (u, v): LonLat => [u, 1 - v] });

  it("decodes terrain-rgb pixels", () => {
    // 1234 m: (1234 + 10000) / 0.1 = 112340 = 0x01B6D4
    expect(decodeHeights([0x01, 0xb6, 0xd4, 255], 1, 1)[0]).toBeCloseTo(1234, 4);
  });

  it("builds a full grid with heights in km and north-up texture coordinates", () => {
    const g = grid(1, false);
    expect(g.positions.length).toBe(25 * 3);
    expect(g.indices.length).toBe(4 * 4 * 6);
    expect(g.heightsKm[24]).toBeCloseTo(2.4);
    expect([g.uvs[0], g.uvs[1]]).toEqual([0, 1]); // north-west corner = top-left of the image
    expect(g.positions[1]).toBe(0); // y comes from the shader
    expect(Math.max(...g.indices)).toBeLessThan(25);
  });

  it("thins the grid by the stride and rejects strides that do not fit", () => {
    const g = grid(2, false);
    expect(g.positions.length).toBe(9 * 3);
    expect(g.heightsKm[8]).toBeCloseTo(2.4);
    expect(() => grid(3, false)).toThrow(/divisible/);
  });

  it("adds a wall around the edge, flagged as skirt, that closes the loop", () => {
    const g = grid(1, true);
    const surface = 25;
    const ring = 4 * 4;
    expect(g.skirt.length).toBe(surface + ring);
    expect(g.skirt.slice(0, surface).every((v) => v === 0)).toBe(true);
    expect(g.skirt.slice(surface).every((v) => v === 1)).toBe(true);
    expect(g.indices.length).toBe(16 * 6 + ring * 6);
    expect(Math.max(...g.indices)).toBeLessThan(surface + ring);
  });

  it("samples a grid between points", () => {
    expect(sampleGrid(heights, size, 0, 0)).toBe(0);
    expect(sampleGrid(heights, size, 1, 1)).toBe(2400);
    expect(sampleGrid(heights, size, 0.125, 0)).toBeCloseTo(50);
    expect(sampleGrid(heights, size, -1, 9)).toBe(2000);
  });

  it("builds a river ribbon that widens with the width hint and keeps distance along it", () => {
    const pts: [number, number, number, number, number][] = [
      [0.4, 0.5, 300, 0, 0.1],
      [0.5, 0.5, 200, 11, 0.5],
      [0.6, 0.5, 0, 22, 1],
    ];
    const r = buildRibbon(pts, frame.toLocal, (w) => 1 + 4 * w, 5);
    expect(r.positions.length).toBe(6 * 3);
    expect(r.indices.length).toBe(2 * 6);
    const width = (i: number) => Math.hypot(r.positions[i * 6]! - r.positions[i * 6 + 3]!, r.positions[i * 6 + 2]! - r.positions[i * 6 + 5]!);
    expect(width(0)).toBeCloseTo(1.4, 5);
    expect(width(2)).toBeCloseTo(5, 5);
    expect(r.heightsKm[0]).toBeCloseTo(0.305);
    expect(r.along[5]).toBe(22);
    expect(() => buildRibbon([pts[0]!], frame.toLocal, () => 1)).toThrow(/two points/);
  });

  it("turns a closed lake outline into shape points without the repeated last point", () => {
    const pts = lakeShapePoints([[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.4]], frame.toLocal);
    expect(pts).toHaveLength(3);
    expect(pts[2]![1]).toBeGreaterThan(0); // north becomes +y on the shape
  });
});

describe("waterFilesToLoad (findings register CR39)", () => {
  it("fetches every outline file for a regional view, before nearby water is known", () => {
    const initial = planScene({ ...base, featureId: "kisumu" });
    expect(initial.mode).toBe("region");
    expect(waterFilesToLoad(initial, manifest).sort()).toEqual([manifest.lakes.file, manifest.rivers.file].sort());
  });

  it("fetches nothing extra for a mountain patch, which shows no nearby water", () => {
    const initial = planScene({ ...base, featureId: "mount-kenya" });
    expect(waterFilesToLoad(initial, manifest)).toEqual([]);
  });
});
