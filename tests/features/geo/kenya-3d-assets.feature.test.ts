/**
 * The 3D assets that SHIP for Kenya Explorer are checked against the real world.
 * (Brief docs/briefs/3d-explorer.md, Phase 1. These are the files in content-assets/, i.e.
 * exactly what a teacher reviews and a child downloads.)
 *
 * Geography shown to children must be right, so: Mount Kenya must really be a ~5,200 m
 * mountain, the Tana must really run downhill from the highlands to the Indian Ocean, and
 * lakes must really be flat at their true level.
 *
 * In CI the image files are Git LFS pointers (we do not download them on every run,
 * ADR-0009). Sizes, fingerprints and budgets are still verified from the pointers; the
 * scenarios that need real pixels are skipped there and run locally and in the
 * content-assets workflow.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import {
  Assets3dManifest,
  LakesFile,
  RiversFile,
  DELIVERY_BUDGET,
  deliveryBudgetViolations,
  validatePack,
} from "@dunialab/content";
import { createAssetReader, haversineKm, isLfsPointer, verifyAssets, type LonLat } from "../../../tools/geo/src/index.js";
import { feature, scenario } from "../support/gherkin.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const pack = validatePack(JSON.parse(readFileSync(join(ROOT, "packages/content/packs/kenya-explorer.json"), "utf8"))).pack!;
const DIR = join(ROOT, "content-assets", pack.id, "3d");
const MANIFEST = join(DIR, "manifest.json");

const generated = existsSync(MANIFEST);
const manifest = generated ? Assets3dManifest.parse(JSON.parse(readFileSync(MANIFEST, "utf8"))) : undefined;
const firstImage = manifest?.files.find((f) => f.path.endsWith(".webp"));
const pixelsMissing = !generated || !firstImage || isLfsPointer(join(DIR, firstImage.path));
const needsPixels = { skip: generated && pixelsMissing, timeout: 60_000 };
if (generated && pixelsMissing) console.info("[kenya-3d-assets] image files are Git LFS pointers: pixel scenarios skipped.");

const feat = (id: string) => pack.features.find((f) => f.id === id)!;

feature("Kenya Explorer's 3D assets match the real Kenya", () => {
  scenario("the assets exist, are complete and unaltered, and fit the data budget", async ({ given, when, then, and }) => {
    let problems: string[] = ["not verified"];
    await given("the committed 3D assets of the Kenya Explorer pack", () => {
      expect(generated, `no manifest at ${MANIFEST}: run "npm run geo:build"`).toBe(true);
    });
    await when("every file is checked against the manifest", async () => {
      problems = await verifyAssets(DIR);
    });
    await then("sizes and fingerprints match", () => expect(problems).toEqual([]));
    await and("the assets were generated for this version of the pack", () => {
      expect(manifest!.packId).toBe(pack.id);
      expect(manifest!.packVersion).toBe(pack.version);
    });
    await and("what a child downloads is inside every budget", () => {
      expect(deliveryBudgetViolations(manifest!.delivery)).toEqual([]);
      expect(manifest!.delivery.pack3dTotalBytes).toBeLessThanOrEqual(DELIVERY_BUDGET.pack3dTotalBytes);
    });
    await and("every data source is recorded with its licence, and none is non-commercial", () => {
      expect(manifest!.sources.length).toBeGreaterThanOrEqual(2);
      for (const s of manifest!.sources) {
        expect(s.licence).not.toMatch(/non-?commercial|\bNC\b/i);
        expect(s.licenceUrl).toMatch(/^https:\/\//);
      }
      expect(manifest!.sources.map((s) => s.id).join(",")).not.toMatch(/hydro(sheds|rivers)/i);
    });
    await and("the border question is flagged for teacher review", () => {
      expect(manifest!.review.flags.map((f) => f.id)).toContain("borders-not-baked");
    });
  });

  scenario("every mountain and the Rift Valley have an HD close-up; cities and lakes do not", async ({ given, then, and }) => {
    await given("the committed manifest", () => expect(generated).toBe(true));
    const patchIds = () => manifest!.patches.map((p) => p.featureId).sort();
    await then("the three mountains and the valley each have a patch", () => {
      expect(patchIds()).toEqual(["great-rift-valley", "kilimanjaro", "mount-elgon", "mount-kenya"]);
    });
    await and("each patch fits its own budget", () => {
      for (const bytes of Object.values(manifest!.delivery.hdFeaturePatchBytes)) {
        expect(bytes).toBeLessThanOrEqual(DELIVERY_BUDGET.hdFeaturePatchBytes);
      }
    });
  });

  scenario(
    "the mountains are really that high",
    async ({ given, when, then, and }) => {
      const reader = createAssetReader(DIR);
      const peak = async (id: string) => {
        const patch = await reader.patchHeights(id);
        let max = -Infinity;
        let at: LonLat = [0, 0];
        for (let i = 0; i < patch.data.length; i++) {
          if (patch.data[i]! > max) {
            max = patch.data[i]!;
            at = patch.lonLatOf(i);
          }
        }
        return { max, at };
      };
      let kenyaPeak = { max: 0, at: [0, 0] as LonLat };
      let kili = { max: 0, at: [0, 0] as LonLat };
      await given("the HD patches around Mount Kenya and Kilimanjaro", () => {});
      await when("the highest point of each is read from the shipped files", async () => {
        kenyaPeak = await peak("mount-kenya");
        kili = await peak("kilimanjaro");
      });
      await then("Mount Kenya's summit is between 4,900 and 5,300 m, within 15 km of its place on the map", () => {
        expect(kenyaPeak.max).toBeGreaterThan(4900);
        expect(kenyaPeak.max).toBeLessThan(5300);
        expect(haversineKm(kenyaPeak.at, feat("mount-kenya").anchor)).toBeLessThan(15);
      });
      await and("Kilimanjaro's is between 5,600 and 5,950 m, within 15 km of its place on the map", () => {
        expect(kili.max).toBeGreaterThan(5600);
        expect(kili.max).toBeLessThan(5950);
        expect(haversineKm(kili.at, feat("kilimanjaro").anchor)).toBeLessThan(15);
      });
    },
    needsPixels,
  );

  scenario("the Tana runs downhill from the highlands to the Indian Ocean", async ({ given, when, then, and }) => {
    await given("the committed river file", () => expect(generated).toBe(true));
    let points: [number, number, number, number, number][] = [];
    const summary = () => manifest!.rivers.items.find((r) => r.featureId === "tana-river")!;
    await when("the Tana is read", () => {
      const rivers = RiversFile.parse(JSON.parse(readFileSync(join(DIR, manifest!.rivers.file), "utf8")));
      points = rivers.rivers.find((r) => r.featureId === "tana-river")!.points;
    });
    await then("it starts within 10 km of where the pack's river line starts", () => {
      expect(haversineKm([points[0]![0], points[0]![1]], feat("tana-river").path![0]!)).toBeLessThan(10);
    });
    await and("it starts in the highlands, above 1,000 m", () => expect(points[0]![2]).toBeGreaterThan(1000));
    await and("it ends in the sea, at 5 m or lower, on the coast near where the pack's line ends", () => {
      const last = points.at(-1)!;
      expect(summary().endsIn).toBe("sea");
      expect(last[2]).toBeLessThanOrEqual(5);
      expect(haversineKm([last[0], last[1]], feat("tana-river").path!.at(-1)!)).toBeLessThan(40);
    });
    await and("water never flows uphill", () => {
      for (let i = 1; i < points.length; i++) expect(points[i]![2]).toBeLessThanOrEqual(points[i - 1]![2]);
    });
    await and("its course follows the surveyed line of the river", () => {
      expect(summary().guided).toBe(true);
      expect(summary().maxOffGuideKm!).toBeLessThan(20);
    });
    await and("its length from this starting point is believable", () => {
      // The whole Tana is about 1,000 km from its farthest source. The pack's line starts
      // further downstream, and a ~185 m grid cannot follow small meanders, so the traced
      // length is shorter. Recorded here so a big change is noticed.
      expect(summary().lengthKm).toBeGreaterThan(550);
      expect(summary().lengthKm).toBeLessThan(1150);
    });
  });

  scenario(
    "the river's mouth touches the sea in the terrain itself",
    async ({ given, when, then }) => {
      const reader = createAssetReader(DIR);
      const rivers = RiversFile.parse(JSON.parse(readFileSync(join(DIR, manifest!.rivers.file), "utf8")));
      const last = rivers.rivers.find((r) => r.featureId === "tana-river")!.points.at(-1)!;
      let lowestNearby = Infinity;
      await given("the last point of the Tana", () => {});
      await when("the terrain around it is read from the regional tiles", async () => {
        for (let dx = -3; dx <= 3; dx++)
          for (let dy = -3; dy <= 3; dy++) {
            lowestNearby = Math.min(lowestNearby, await reader.heightAt([last[0] + dx * 0.01, last[1] + dy * 0.01]));
          }
      });
      await then("there is sea (0 m) within about 3 km", () => expect(lowestNearby).toBeLessThanOrEqual(0.5));
    },
    needsPixels,
  );

  scenario("the great lakes are flat, at their true level", async ({ given, when, then, and }) => {
    await given("the committed lake file", () => expect(generated).toBe(true));
    let lakes: LakesFile["lakes"] = [];
    await when("the lakes are read", () => {
      lakes = LakesFile.parse(JSON.parse(readFileSync(join(DIR, manifest!.lakes.file), "utf8"))).lakes;
    });
    const level = (id: string) => lakes.find((l) => l.featureId === id)!.surfaceMetres;
    await then("Lake Victoria's surface is at 1,134 m, give or take 15 m", () => {
      expect(Math.abs(level("lake-victoria") - 1134)).toBeLessThanOrEqual(15);
    });
    await and("Lake Turkana's surface is at 360 m, give or take 15 m", () => {
      expect(Math.abs(level("lake-turkana") - 360)).toBeLessThanOrEqual(15);
    });
    await and("both are big lakes with a real outline", () => {
      for (const id of ["lake-victoria", "lake-turkana"]) {
        expect(manifest!.lakes.items.find((l) => l.featureId === id)!.areaKm2).toBeGreaterThan(3000);
        expect(lakes.find((l) => l.featureId === id)!.outline.length).toBeGreaterThan(20);
      }
    });
    await and("Lake Victoria is marked as continuing beyond the map's edge", () => {
      expect(manifest!.lakes.items.find((l) => l.featureId === "lake-victoria")!.clippedByMap).toBe(true);
    });
  });

  scenario(
    "the lake surface in the terrain is flat",
    async ({ given, when, then }) => {
      const reader = createAssetReader(DIR);
      const lake = LakesFile.parse(JSON.parse(readFileSync(join(DIR, manifest!.lakes.file), "utf8"))).lakes.find(
        (l) => l.featureId === "lake-turkana",
      )!;
      const samples: number[] = [];
      await given("points on Lake Turkana's water, away from the shore", () => {});
      await when("the terrain height is read at each", async () => {
        const anchor = feat("lake-turkana").anchor;
        for (const d of [-0.05, 0, 0.05]) samples.push(await reader.heightAt([anchor[0], anchor[1] + d]));
      });
      await then("every one is at the lake's level", () => {
        for (const h of samples) expect(Math.abs(h - lake.surfaceMetres)).toBeLessThanOrEqual(1.5);
      });
    },
    needsPixels,
  );
});
