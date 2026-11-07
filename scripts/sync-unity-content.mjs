#!/usr/bin/env node
// Copy validated content packs into the Unity project so Addressables can bundle them.
// Single source of truth stays in packages/content/packs. Run: npm run sync:unity-content
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "packages", "content", "packs");
const dest = join(root, "apps", "unity", "Assets", "DuniaLab", "Content", "Packs");

// Refuse to sync invalid content.
execFileSync(process.execPath, [join(root, "packages", "content", "dist", "cli", "validate.js"), src], { stdio: "inherit" });

mkdirSync(dest, { recursive: true });
for (const f of readdirSync(src).filter((f) => f.endsWith(".json"))) {
  cpSync(join(src, f), join(dest, f));
  console.log(`synced ${f} -> ${dest}`);
}
