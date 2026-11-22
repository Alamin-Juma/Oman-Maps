/**
 * Founder: "Tapping on the web app or phone app pops up the mountains and shows full HD 3D."
 * Brief docs/briefs/3d-explorer.md, Phase 2: the 3D viewer for mountains, lakes and the valley.
 *
 * The viewer is split in two (ADR-0008): a pure SCENE PLANNER decides what to show for a
 * tapped feature (which terrain files, how high, where the camera goes, what text), and the
 * renderer only executes that plan. These scenarios pin the planner against the real Kenya
 * Explorer pack and its committed 3D assets (manifest and JSON only, so they also run in CI).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { createServer } from "vite";
import { Assets3dManifest, DELIVERY_BUDGET, LakesFile, RiversFile, validatePack } from "@dunialab/content";
import { chooseTier, has3d, plannedFiles, planScene, supports3d, waterFilesToLoad } from "../../../apps/web/src/three/plan.js";
import { feature, scenario } from "../support/gherkin.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const pack = validatePack(JSON.parse(readFileSync(join(ROOT, "packages/content/packs/kenya-explorer.json"), "utf8"))).pack!;
const DIR = join(ROOT, "content-assets", pack.id, "3d");
const manifest = Assets3dManifest.parse(JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")));
const lakes = LakesFile.parse(JSON.parse(readFileSync(join(DIR, "lakes.json"), "utf8")));
const rivers = RiversFile.parse(JSON.parse(readFileSync(join(DIR, "rivers.json"), "utf8")));
const base = { pack, manifest, lakes, rivers, tier: "medium" as const, reducedMotion: false };
const feat = (id: string) => pack.features.find((f) => f.id === id)!;
const bytesOf = (paths: string[]) => paths.reduce((sum, p) => sum + manifest.files.find((f) => f.path === p)!.bytes, 0);

feature("See the map in 3D", () => {
  scenario("learners receive only manifest-listed assets, never previews or other files", async ({ given, when, then }) => {
    const server = await createServer({ root: join(ROOT, "apps/web"), server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
    try {
      await given("the app's own asset server", () => server.listen());
      let response: Response;
      const base = `${server.resolvedUrls!.local[0]}content-assets/${pack.id}/3d/`;
      await when("a learner asks for the manifest", async () => { response = await fetch(`${base}manifest.json`); });
      await then("the manifest is JSON and unlisted paths are refused", async () => {
        expect(response!.status).toBe(200);
        expect(response!.headers.get("content-type")).toContain("application/json");
        expect(Assets3dManifest.parse(await response!.json()).packId).toBe(pack.id);
        for (const path of ["previews/overview.jpg", "secret.json", "%2e%2e%2fmanifest.json"]) {
          expect((await fetch(base + path)).status).toBe(404);
        }
      });
    } finally {
      await server.close();
    }
  });

  scenario("tapping Mount Kenya pops the real mountain up out of the flat map", async ({ given, when, then, and }) => {
    let plan = planScene({ ...base, featureId: null });
    await given("a child exploring the Kenya map on a normal phone", () => {});
    await when("they tap Mount Kenya and choose See in 3D", () => {
      plan = planScene({ ...base, featureId: "mount-kenya" });
    });
    await then("the HD close-up of Mount Kenya is shown", () => {
      expect(plan.mode).toBe("patch");
      expect(plan.patch?.featureId).toBe("mount-kenya");
    });
    await and("the land starts flat and rises, so the mountain visibly pops up", () => {
      expect(plan.exaggeration.from).toBe(0);
      expect(plan.exaggeration.to).toBeGreaterThan(1);
      expect(plan.exaggeration.durationMs).toBeGreaterThan(500);
    });
    await and("the camera looks at the mountain from an angle, not from straight above", () => {
      expect(plan.focus).toEqual(feat("mount-kenya").anchor);
      expect(plan.camera.pitchDeg).toBeGreaterThan(20);
      expect(plan.camera.pitchDeg).toBeLessThan(70);
    });
    await and("the close-up costs no more than one HD patch of data", () => {
      expect(bytesOf(plannedFiles(plan, manifest))).toBeLessThanOrEqual(DELIVERY_BUDGET.hdFeaturePatchBytes);
    });
  });

  scenario("numbers shown to the child are the teacher-approved facts, and the exaggeration is declared", async ({ given, when, then, and }) => {
    let plan = planScene({ ...base, featureId: null });
    await given("the 3D view of Mount Kenya", () => {
      plan = planScene({ ...base, featureId: "mount-kenya" });
    });
    await when("the information card is filled in", () => {});
    await then("it shows the pack's facts, word for word", () => {
      expect(plan.facts).toEqual(feat("mount-kenya").facts);
      expect(plan.facts.map((f) => f.en).join(" ")).toMatch(/5,199/);
    });
    await and("the plan says how much heights are exaggerated, so the screen can say so", () => {
      expect(plan.exaggeration.to).toBeGreaterThan(1);
      expect(plan.exaggerationNote.en).toMatch(/×\s?\d/);
      expect(plan.exaggerationNote.sw.length).toBeGreaterThan(0);
    });
  });

  scenario("tapping a lake shows the land around it with the water at its true level", async ({ given, when, then, and }) => {
    let plan = planScene({ ...base, featureId: null });
    await given("the Kenya map", () => {});
    await when("Lake Turkana is opened in 3D", () => {
      plan = planScene({ ...base, featureId: "lake-turkana" });
    });
    await then("a regional view around the lake is shown, with the lake's water drawn", () => {
      expect(plan.mode).toBe("region");
      expect(plan.lakeIds).toContain("lake-turkana");
    });
    await and("only land tiles that really exist are loaded, and not too many for a phone", () => {
      const listed = new Set(manifest.regional.tiles.map((t) => `${t.x}/${t.y}`));
      expect(plan.tiles.length).toBeGreaterThan(0);
      expect(plan.tiles.length).toBeLessThanOrEqual(9);
      for (const t of plan.tiles) {
        expect(t.z).toBe(manifest.regional.zoom);
        expect(listed.has(`${t.x}/${t.y}`)).toBe(true);
      }
    });
  });

  scenario("the Rift Valley gets its own close-up", async ({ when, then }) => {
    let plan = planScene({ ...base, featureId: null });
    await when("the Great Rift Valley is opened in 3D", () => {
      plan = planScene({ ...base, featureId: "great-rift-valley" });
    });
    await then("its HD patch is shown", () => {
      expect(plan.mode).toBe("patch");
      expect(plan.patch?.featureId).toBe("great-rift-valley");
    });
  });

  scenario("tapping the Tana shows the whole river on the country map", async ({ when, then, and }) => {
    let plan = planScene({ ...base, featureId: null });
    await when("the River Tana is opened in 3D", () => {
      plan = planScene({ ...base, featureId: "tana-river" });
    });
    await then("the whole-country terrain is shown with the river drawn on it", () => {
      expect(plan.mode).toBe("overview");
      expect(plan.riverIds).toEqual(["tana-river"]);
    });
    await and("the camera is framed on the river's course, not on the middle of the country", () => {
      const tana = rivers.rivers.find((r) => r.featureId === "tana-river")!.points;
      const lons = tana.map((p) => p[0]);
      expect(plan.focus[0]).toBeGreaterThan(Math.min(...lons));
      expect(plan.focus[0]).toBeLessThan(Math.max(...lons));
    });
  });

  scenario("all of Kenya in 3D opens cheaply, inside the first-open data budget", async ({ when, then, and }) => {
    let plan = planScene({ ...base, featureId: "mount-kenya" });
    await when("the child opens Kenya in 3D without picking a place", () => {
      plan = planScene({ ...base, featureId: null });
    });
    await then("the country overview is shown, with every lake and river", () => {
      expect(plan.mode).toBe("overview");
      expect(plan.lakeIds.sort()).toEqual(["lake-turkana", "lake-victoria"]);
      expect(plan.riverIds).toEqual(["tana-river"]);
    });
    await and("the data it needs fits the 3 MB first-open budget", () => {
      expect(bytesOf(plannedFiles(plan, manifest))).toBeLessThanOrEqual(DELIVERY_BUDGET.first3dOpenBytes);
    });
    await and("places are labelled with their names from the pack", () => {
      expect(plan.labels.map((l) => l.text.en)).toContain("Mount Kenya");
      expect(plan.labels.every((l) => l.featureId !== undefined)).toBe(true);
    });
  });

  scenario("budget phones get a lighter model; phones without 3D graphics keep the 2D map", async ({ given, then, and }) => {
    await given("three phones: a 2 GB budget phone, a 4 GB phone, and one whose browser has no WebGL2", () => {});
    await then("the budget phone gets the lightest mesh", () => {
      expect(chooseTier({ webgl2: true, deviceMemoryGB: 2 })).toBe("low");
      expect(chooseTier({ webgl2: true, deviceMemoryGB: 4 })).toBe("medium");
      const low = planScene({ ...base, tier: "low", featureId: "mount-kenya" });
      const medium = planScene({ ...base, tier: "medium", featureId: "mount-kenya" });
      expect(low.meshStride).toBeGreaterThan(medium.meshStride);
    });
    await and("without WebGL2 no 3D is offered at all", () => {
      expect(supports3d({ webgl2: false, deviceMemoryGB: 8 })).toBe(false);
      expect(supports3d({ webgl2: true })).toBe(true);
    });
    await and("map elements like the compass have no 3D view", () => {
      expect(has3d(feat("mount-kenya"))).toBe(true);
      expect(has3d({ ...feat("mount-kenya"), kind: "map-element" })).toBe(false);
    });
  });

  scenario("a child who prefers less motion gets no rising or flying animation", async ({ when, then }) => {
    let plan = planScene({ ...base, featureId: null });
    await when("Mount Kenya is opened with reduced motion switched on", () => {
      plan = planScene({ ...base, reducedMotion: true, featureId: "mount-kenya" });
    });
    await then("the mountain is shown at full height straight away", () => {
      expect(plan.exaggeration.durationMs).toBe(0);
      expect(plan.exaggeration.from).toBe(plan.exaggeration.to);
    });
  });

  scenario("the 3D viewer code never names a real place", async ({ when, then }) => {
    let offenders: string[] = [];
    await when("the viewer's source is searched for names from the Kenya pack", () => {
      const dir = join(ROOT, "apps/web/src/three");
      const names = /kenya|tana\b|victoria|turkana|elgon|kilimanjaro|nairobi|mombasa|kisumu|rift/i;
      offenders = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && names.test(readFileSync(join(dir, f), "utf8")));
    });
    await then("none is found: behaviour comes from the feature's kind and the data", () => expect(offenders).toEqual([]));
  });

  scenario("a town's regional view shows the lake and river nearby (findings register CR39)", async ({ given, when, then }) => {
    const ask = { pack, manifest, tier: "medium" as const, reducedMotion: false };
    let files: string[] = [];
    let kisumu: string[] = [];
    let nairobi: string[] = [];
    await given("a child opens the 3D view of Kisumu, on Lake Victoria's shore, and of Nairobi, near the Tana", () => {});
    await when("the app decides what to fetch before it knows where the water is", () => {
      files = waterFilesToLoad(planScene({ ...ask, featureId: "kisumu" }), manifest);
    });
    await then("it fetches the lake and river outlines, and the scene then includes them", () => {
      expect(files.sort()).toEqual([manifest.lakes.file, manifest.rivers.file].sort());
      kisumu = planScene({ ...ask, featureId: "kisumu", lakes, rivers }).lakeIds;
      nairobi = planScene({ ...ask, featureId: "nairobi", lakes, rivers }).riverIds;
      expect(kisumu).toContain("lake-victoria");
      expect(nairobi).toContain("tana-river");
    });
  });

  scenario("positive control: the whole-country view still fetches its water as before", async ({ then }) => {
    await then("both outline files are fetched for the overview", () => {
      const overview = planScene({ ...base, lakes: undefined, rivers: undefined, featureId: null });
      expect(waterFilesToLoad(overview, manifest).sort()).toEqual([manifest.lakes.file, manifest.rivers.file].sort());
    });
  });
});

