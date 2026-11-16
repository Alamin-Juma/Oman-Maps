/**
 * E2E (build): the web app's first load stays inside the data budget.
 *
 * Brief docs/briefs/3d-explorer.md §3.6: "The initial web app load does not grow; the 3D code
 * is a lazy chunk." This builds the real production bundle and measures the JavaScript the
 * browser must download before the app is usable: the entry script plus everything
 * index.html preloads. Lazy chunks (the future 3D code) are deliberately NOT counted here;
 * they are counted against the "first 3D open" budget instead.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELIVERY_BUDGET, deliveryBudgetViolations } from "@dunialab/content";

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
});
