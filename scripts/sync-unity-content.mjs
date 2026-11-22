#!/usr/bin/env node
/**
 * Copy content packs into the Unity project so Addressables can bundle them into the learner app.
 * The source of truth stays in packages/content/packs. Run: npm run sync:unity-content
 *
 * Only teacher-approved packs are copied (product rule; findings register CR4). A developer can pass
 * --allow-drafts to include drafts for local work; never for a build that reaches children.
 * Packs that no longer exist in the source are removed from Unity (CR81). Nothing in Unity changes
 * unless every pack is valid.
 *
 * DUNIALAB_PACKS_DIR and DUNIALAB_UNITY_PACKS_DIR override the two folders (tests only).
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.env.DUNIALAB_PACKS_DIR ?? join(root, "packages", "content", "packs");
const dest = process.env.DUNIALAB_UNITY_PACKS_DIR ?? join(root, "apps", "unity", "Assets", "DuniaLab", "Content", "Packs");
const allowDrafts = process.argv.includes("--allow-drafts");

// Refuse to sync invalid content (throws, so nothing below runs).
execFileSync(process.execPath, [join(root, "scripts", "validate-content.mjs"), src], { stdio: "inherit" });

const wanted = readdirSync(src)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => {
    const status = JSON.parse(readFileSync(join(src, f), "utf8")).review.status;
    if (status === "approved" || allowDrafts) return true;
    console.log(`skipped ${f}: review status "${status}", not approved (use --allow-drafts for local development only)`);
    return false;
  });

mkdirSync(dest, { recursive: true });
for (const f of readdirSync(dest).filter((f) => f.endsWith(".json") && !wanted.includes(f))) {
  rmSync(join(dest, f));
  console.log(`removed ${f}: not an approved pack in ${src}`);
}
for (const f of wanted) {
  cpSync(join(src, f), join(dest, f));
  console.log(`synced ${f} -> ${dest}`);
}
if (!existsSync(dest) || wanted.length === 0) console.log("no packs synced: none is approved yet");
