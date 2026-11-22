/**
 * Product rule (CLAUDE.md §4): only `review.status = "approved"` packs ship to children in production.
 * `npm run sync:unity-content` copies packs into the Unity Addressables folder, from which they go
 * into the learner app. Findings register CR4 (drafts were copied) and CR81 (packs removed from the
 * source stayed in Unity). Also CR80: the content validator runs from scripts/, not from inside the
 * pure content package.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect } from "vitest";
import { feature, scenario } from "../support/gherkin.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SYNC = join(ROOT, "scripts", "sync-unity-content.mjs");
const base = JSON.parse(readFileSync(join(ROOT, "packages", "content", "packs", "kenya-explorer.json"), "utf8"));
const work = mkdtempSync(join(tmpdir(), "dunialab-unity-sync-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A packs folder with one approved and one draft pack, and a Unity folder holding an old pack. */
function folders(name: string) {
  const packs = join(work, name, "packs");
  const unity = join(work, name, "unity");
  mkdirSync(packs, { recursive: true });
  mkdirSync(unity, { recursive: true });
  writeFileSync(join(packs, "approved.json"), JSON.stringify({ ...base, id: "zz.approved", review: { ...base.review, status: "approved", reviewedBy: "Teacher" } }));
  writeFileSync(join(packs, "draft.json"), JSON.stringify({ ...base, id: "zz.draft", review: { ...base.review, status: "draft" } }));
  writeFileSync(join(unity, "removed-from-source.json"), "{}");
  writeFileSync(join(unity, "notes.txt"), "not a pack: left alone");
  return { packs, unity };
}
const sync = (packs: string, unity: string, ...args: string[]) =>
  spawnSync(process.execPath, [SYNC, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, DUNIALAB_PACKS_DIR: packs, DUNIALAB_UNITY_PACKS_DIR: unity } });

feature("Unity receives only content that may reach children", () => {
  scenario("a sync copies approved packs, leaves drafts out, and removes packs that no longer exist", async ({ given, when, then, and }) => {
    let dirs = { packs: "", unity: "" };
    let status: number | null = null;
    await given("an approved pack, a draft pack, and an old pack already in Unity", () => {
      dirs = folders("plain");
    });
    await when("the content is synced to Unity", () => {
      status = sync(dirs.packs, dirs.unity).status;
    });
    await then("only the approved pack is in Unity", () => {
      expect(status).toBe(0);
      expect(readdirSync(dirs.unity).filter((f) => f.endsWith(".json"))).toEqual(["approved.json"]);
    });
    await and("files that are not packs are left alone", () => expect(existsSync(join(dirs.unity, "notes.txt"))).toBe(true));
  });

  scenario("a development sync may include drafts, but only when asked", async ({ given, when, then }) => {
    let dirs = { packs: "", unity: "" };
    await given("the same folders", () => {
      dirs = folders("drafts");
    });
    await when("a developer syncs with --allow-drafts", () => {
      expect(sync(dirs.packs, dirs.unity, "--allow-drafts").status).toBe(0);
    });
    await then("the draft is there too", () => {
      expect(readdirSync(dirs.unity).filter((f) => f.endsWith(".json")).sort()).toEqual(["approved.json", "draft.json"]);
    });
  });

  scenario("an invalid pack stops the sync before anything changes", async ({ given, when, then }) => {
    let dirs = { packs: "", unity: "" };
    let status: number | null = null;
    await given("a packs folder with a broken pack", () => {
      dirs = folders("broken");
      writeFileSync(join(dirs.packs, "broken.json"), JSON.stringify({ ...base, id: "zz.broken", missions: [] }));
    });
    await when("the content is synced", () => {
      status = sync(dirs.packs, dirs.unity).status;
    });
    await then("it fails, and Unity's folder is untouched", () => {
      expect(status).not.toBe(0);
      expect(readdirSync(dirs.unity).sort()).toEqual(["notes.txt", "removed-from-source.json"]);
    });
  });

  scenario("the content validator is a tool, not part of the pure content package (CR80)", async ({ then }) => {
    await then("packages/content has no command-line code, and the validator runs from scripts/", () => {
      expect(existsSync(join(ROOT, "packages", "content", "src", "cli"))).toBe(false);
      const run = spawnSync(process.execPath, [join(ROOT, "scripts", "validate-content.mjs"), join(ROOT, "packages", "content", "packs")], { encoding: "utf8" });
      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/ok .*kenya-explorer\.json/);
    });
  });
});
