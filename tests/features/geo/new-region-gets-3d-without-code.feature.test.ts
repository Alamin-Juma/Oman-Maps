/**
 * ADR-0004: new grades, subjects and countries are content drops.
 * ADR-0009: 3D assets come from a generator that reads packs and never names one.
 *
 * Here a pack for a made-up island (no real place, no network: elevation comes from a
 * formula) goes through the real generator. If this passes, a Grade 6 East Africa pack gets
 * its 3D terrain, rivers and lakes by running the same command.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { Assets3dManifest, DELIVERY_BUDGET, LakesFile, RiversFile, deliveryBudgetViolations, type ContentPack } from "@dunialab/content";
import { generatePack, syntheticElevation, verifyAssets } from "../../../tools/geo/src/index.js";
import { feature, scenario } from "../support/gherkin.js";

const kenya = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../packages/content/packs/kenya-explorer.json", import.meta.url)), "utf8"),
) as ContentPack;

/** An island about 200 km across: a 3,000 m cone, a lake on a shelf, a valley running east to the sea. */
const PEAK: [number, number] = [10.6, 20.5];
const LAKE: [number, number] = [11.3, 20.9];
const islandHeight = (lon: number, lat: number) => {
  const fromCentre = Math.hypot(lon - 11, lat - 20.5);
  if (fromCentre > 0.95) return 0; // sea
  const coastRise = (0.95 - fromCentre) * 500;
  const cone = Math.max(0, 3000 - Math.hypot(lon - PEAK[0], lat - PEAK[1]) * 9000);
  const lake = Math.hypot(lon - LAKE[0], lat - LAKE[1]) < 0.09;
  const valley = lon > 11 ? Math.min(150, Math.abs(lat - 20.4) * 1500) : 150;
  return lake ? 300 : 20 + coastRise + cone + valley;
};

const name = (en: string) => ({ en, sw: en });
const islandPack: ContentPack = {
  ...kenya,
  id: "zz.test.island",
  version: "9.9.9",
  printTarget: { ...kenya.printTarget, id: "island-test", bounds: [[10, 19.5], [12, 21.5]] },
  features: [
    { id: "big-peak", kind: "mountain", name: name("Big Peak"), anchor: PEAK, facts: [] },
    { id: "east-river", kind: "river", name: name("East River"), anchor: [11.5, 20.4], path: [[11.05, 20.42], [11.5, 20.4], [11.97, 20.4]], facts: [] },
    { id: "shelf-lake", kind: "lake", name: name("Shelf Lake"), anchor: LAKE, facts: [] },
    { id: "port-town", kind: "city", name: name("Port Town"), anchor: [11.9, 20.4], facts: [] },
  ],
};

// Small images keep the test fast; the real command uses the defaults.
const SMALL = { heightSize: 65, textureSize: 64, regionalTextureSize: 64, patchHeightSize: 65, patchTextureSize: 128, regionalMetresPerPixel: 600 };

feature("A new region gets 3D terrain, rivers and lakes with no code change", () => {
  let outDir = "";
  const cleanup = () => outDir && rmSync(outDir, { recursive: true, force: true });

  scenario(
    "a pack for a place the code has never heard of is generated and verified",
    async ({ given, when, then, and }) => {
      outDir = mkdtempSync(join(tmpdir(), "dunialab-geo-feature-"));
      let manifest: Assets3dManifest | undefined;
      await given("a content pack for a made-up island with a mountain, a river, a lake and a town", () => {});
      await when("the generator runs on it", async () => {
        manifest = await generatePack({
          pack: islandPack,
          outDir,
          sources: { elevation: syntheticElevation(islandHeight) },
          params: SMALL,
        });
      });
      await then("it writes a manifest that follows the published format", () => {
        const onDisk = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
        expect(() => Assets3dManifest.parse(onDisk)).not.toThrow();
        expect(onDisk.packId).toBe("zz.test.island");
        expect(onDisk.packVersion).toBe("9.9.9");
      });
      await and("the country overview and regional tiles exist, and open sea is not stored", () => {
        expect(manifest!.overview.tiles.length).toBeGreaterThan(0);
        expect(manifest!.overview.tiles.length).toBeLessThanOrEqual(9);
        expect(manifest!.regional.zoom).toBeGreaterThan(manifest!.overview.zoom);
        expect(manifest!.regional.tiles.length).toBeGreaterThan(0);
      });
      await and("the mountain gets an HD close-up patch, because of its kind, and the town does not", () => {
        expect(manifest!.patches.map((p) => p.featureId)).toEqual(["big-peak"]);
        const [low, high] = manifest!.patches[0]!.elevationRange;
        expect(high).toBeGreaterThan(2500);
        expect(low).toBeLessThan(high);
      });
      await and("the river is traced from its source to the sea", () => {
        const rivers = RiversFile.parse(JSON.parse(readFileSync(join(outDir, manifest!.rivers.file), "utf8")));
        expect(rivers.rivers.map((r) => r.featureId)).toEqual(["east-river"]);
        expect(manifest!.rivers.items[0]!.endsIn).toBe("sea");
        expect(manifest!.rivers.items[0]!.guided).toBe(false);
      });
      await and("the lake's surface level and outline are found", () => {
        const lakes = LakesFile.parse(JSON.parse(readFileSync(join(outDir, manifest!.lakes.file), "utf8")));
        expect(lakes.lakes.map((l) => l.featureId)).toEqual(["shelf-lake"]);
        expect(lakes.lakes[0]!.surfaceMetres).toBeCloseTo(300, 0);
        expect(manifest!.lakes.items[0]!.areaKm2).toBeGreaterThan(100);
      });
      await and("every file matches its recorded size and fingerprint, inside the data budget", async () => {
        expect(await verifyAssets(outDir)).toEqual([]);
        expect(deliveryBudgetViolations(manifest!.delivery)).toEqual([]);
        expect(manifest!.delivery.first3dOpenBytes).toBeLessThan(DELIVERY_BUDGET.first3dOpenBytes);
      });
      await and("preview pictures are written for a human to check", () => {
        expect(manifest!.files.filter((f) => f.role === "preview").length).toBeGreaterThanOrEqual(3);
      });
      await and("the assets start as a draft that needs review", () => {
        expect(manifest!.review.status).toBe("draft");
      });
    },
    { timeout: 120_000 },
  );

  scenario("a changed or damaged file is caught", async ({ given, when, then }) => {
    let problems: string[] = [];
    await given("generated assets where one terrain file was altered after generation", () => {
      const tileDir = join(outDir, "tiles");
      const z = readdirSync(tileDir)[0]!;
      const x = readdirSync(join(tileDir, z))[0]!;
      const y = readdirSync(join(tileDir, z, x))[0]!;
      appendFileSync(join(tileDir, z, x, y, "h.webp"), "tampered");
    });
    await when("the assets are verified", async () => {
      problems = await verifyAssets(outDir);
    });
    await then("the altered file is named", () => {
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join("\n")).toMatch(/h\.webp/);
      cleanup();
    });
  });

  scenario("the generator's code never names a real place", async ({ given, when, then }) => {
    const src = fileURLToPath(new URL("../../../tools/geo/src", import.meta.url));
    let offenders: string[] = [];
    await given("the generator source code", () => {});
    await when("it is searched for names from the Kenya pack", () => {
      const names = /kenya|tana\b|victoria|turkana|elgon|kilimanjaro|nairobi|mombasa|kisumu|rift/i;
      offenders = readdirSync(src, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".ts"))
        .filter((f) => names.test(readFileSync(join(src, f), "utf8")));
    });
    await then("none is found: behaviour comes from feature kinds and data", () => expect(offenders).toEqual([]));
  });
});
