/**
 * E2E (build): the web app's first load stays inside the data budget.
 *
 * Brief docs/briefs/3d-explorer.md §3.6: "The initial web app load does not grow; the 3D code
 * is a lazy chunk." This builds the real production bundle and measures the JavaScript the
 * browser must download before the app is usable: the entry script plus everything
 * index.html preloads. Lazy chunks (the future 3D code) are deliberately NOT counted here;
 * they are counted against the "first 3D open" budget instead.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Assets3dManifest, DELIVERY_BUDGET, deliveryBudgetViolations, validatePack } from "@dunialab/content";
import { planScene, plannedFiles } from "../../../apps/web/src/three/plan.js";

const WEB_ROOT = fileURLToPath(new URL("../../../apps/web", import.meta.url));

/** JavaScript files index.html makes the browser fetch up front. */
export function initialScripts(indexHtml: string): string[] {
  const urls = new Set<string>();
  for (const m of indexHtml.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) urls.add(m[1]!);
  for (const m of indexHtml.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)) urls.add(m[1]!);
  for (const m of indexHtml.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*\brel="modulepreload"/g)) urls.add(m[1]!);
  return [...urls];
}

describe("E2E (build): first page load stays inside the data budget", () => {
  let outDir = "";

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "dunialab-bundle-"));
    // Vitest sets NODE_ENV=test, which makes the bundle include React's much larger
    // development build (measured: 205.6 kB instead of 143.9 kB). Measure what ships.
    // The only pack is still a draft; this is a rehearsal build that allows it, labelled as draft
    // (findings register S1). tests/e2e/web/approved-content.e2e.test.ts covers the real rule.
    process.env.VITE_ALLOW_DRAFT_CONTENT = "true";
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await build({ root: WEB_ROOT, mode: "production", logLevel: "error", build: { outDir, emptyOutDir: true } });
    } finally {
      process.env.NODE_ENV = previous;
    }
  }, 180_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("downloads no more JavaScript up front than the budget allows", () => {
    const scripts = initialScripts(readFileSync(join(outDir, "index.html"), "utf8"));
    expect(scripts.length, "index.html references no scripts: the measurement would be meaningless").toBeGreaterThan(0);

    const sizes = scripts.map((url) => ({
      url,
      gzip: gzipSync(readFileSync(join(outDir, url.replace(/^\//, "")))).length,
    }));
    const total = sizes.reduce((sum, s) => sum + s.gzip, 0);
    console.info(
      `[bundle-budget] initial JS: ${(total / 1000).toFixed(1)} kB gzip of ${DELIVERY_BUDGET.initialJsGzipBytes / 1000} kB`,
      JSON.stringify(sizes),
    );

    expect(deliveryBudgetViolations({ initialJsGzipBytes: total })).toEqual([]);
  });

  it("keeps lazy JavaScript plus the overview assets within the first 3D open budget", () => {
    const initial = new Set(initialScripts(readFileSync(join(outDir, "index.html"), "utf8")));
    const lazy = readdirSync(join(outDir, "assets")).filter((file) => file.endsWith(".js") && !initial.has(`/assets/${file}`));
    expect(lazy.length).toBeGreaterThan(0);
    const codeBytes = lazy.reduce((sum, file) => sum + gzipSync(readFileSync(join(outDir, "assets", file))).length, 0);
    const pack = validatePack(JSON.parse(readFileSync(join(WEB_ROOT, "../../packages/content/packs/kenya-explorer.json"), "utf8"))).pack!;
    const manifestBytes = readFileSync(join(outDir, "content-assets", pack.id, "3d/manifest.json"));
    const manifest = Assets3dManifest.parse(JSON.parse(manifestBytes.toString()));
    const plan = planScene({ pack, manifest, featureId: null, tier: "medium", reducedMotion: false });
    const assetBytes = plannedFiles(plan, manifest).reduce((sum, path) => sum + manifest.files.find((f) => f.path === path)!.bytes, manifestBytes.length);
    console.info(`[bundle-budget] lazy JS: ${codeBytes} bytes gzip; first 3D open: ${assetBytes + codeBytes} bytes`);
    expect(assetBytes + codeBytes).toBeLessThanOrEqual(DELIVERY_BUDGET.first3dOpenBytes);
  });
});
