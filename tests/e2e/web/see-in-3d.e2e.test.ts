import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { isLfsPointer } from "../../../tools/geo/src/images.js";
import { launchWebglChromium, screenshotPixels, pixelStats } from "../support/browser.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WEB_ROOT = join(ROOT, "apps/web");
const ASSETS = "content-assets/ke.g5.sst.kenya-explorer/3d";
// isLfsPointer takes a PATH. Passing the file's contents (as this line once did) made a real
// pointer read as "not a pointer", so a checkout without the images ran this suite instead of
// skipping it (findings register T3). tsconfig.tests.json now type-checks this file.
const pointers = isLfsPointer(join(ROOT, ASSETS, "patches/mount-kenya/h.webp"));

describe.skipIf(pointers)("E2E: See in 3D (requires real LFS images)", () => {
  let browser: Browser;
  let web: PreviewServer;
  let outDir = "";
  let origin: string;

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "dunialab-3d-"));
    // The only pack is still a draft; this is a rehearsal build that allows it, labelled as draft
    // (findings register S1). tests/e2e/web/approved-content.e2e.test.ts covers the real rule.
    // Restore both afterwards, so no later build in this process inherits them (findings register CR52).
    const previous = process.env.NODE_ENV;
    const previousDraft = process.env.VITE_ALLOW_DRAFT_CONTENT;
    process.env.VITE_ALLOW_DRAFT_CONTENT = "true";
    process.env.NODE_ENV = "production";
    try { await build({ root: WEB_ROOT, logLevel: "error", build: { outDir, emptyOutDir: true } }); }
    finally {
      process.env.NODE_ENV = previous;
      if (previousDraft === undefined) delete process.env.VITE_ALLOW_DRAFT_CONTENT;
      else process.env.VITE_ALLOW_DRAFT_CONTENT = previousDraft;
    }
    web = await preview({ root: WEB_ROOT, logLevel: "error", build: { outDir }, preview: { host: "127.0.0.1", port: 0 } });
    origin = web.resolvedUrls!.local[0]!;
    browser = await launchWebglChromium();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await web?.close();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });
  afterEach(async () => {
    for (const context of browser?.contexts() ?? []) await context.close();
  });

  async function phoneContext(options: Parameters<Browser["newContext"]>[0] = {}) {
    const context = await browser.newContext(options);
    await context.addInitScript(() => Object.defineProperty(navigator, "deviceMemory", { value: 4, configurable: true }));
    return context;
  }

  async function ready(page: Page) {
    const start = Date.now();
    await page.locator('[data-scene-ready="true"], [role="alert"]').waitFor({ timeout: 60_000 });
    expect(await page.locator('[data-scene-ready="true"]').count(), await page.locator(".map-wrap").innerText()).toBe(1);
    console.info(`[3d] ready in ${Date.now() - start} ms`);
  }
  /** The canvas without the text overlays, captured the same way every time (findings register CR51). */
  async function terrainOnly(page: Page) {
    const overlays = page.locator(".viewer3d-labels, .viewer3d-actions");
    await overlays.evaluateAll((elements) => elements.forEach((element) => { (element as HTMLElement).style.visibility = "hidden"; }));
    try { return await screenshotPixels(page, page.locator(".viewer3d canvas")); }
    finally { await overlays.evaluateAll((elements) => elements.forEach((element) => { (element as HTMLElement).style.visibility = ""; })); }
  }
  async function pixels(page: Page) {
    // Text overlays must not make an otherwise blank terrain pass the colour threshold.
    const image = await terrainOnly(page);
    const stats = pixelStats(image.rgba, image.width, image.height);
    expect(stats.distinctColors).toBeGreaterThan(500);
    expect(stats.variance).toBeGreaterThan(150);
    return image;
  }

  it("raises the mountain, shows approved facts, supports orbit, and returns to 2D", async () => {
    const context = await phoneContext({ viewport: { width: 1000, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(origin);
    await page.getByRole("button", { name: "Mount Kenya", exact: true }).click();
    await page.getByRole("button", { name: "See in 3D", exact: true }).click();
    await ready(page);
    const early = await page.locator(".viewer3d").getAttribute("data-exaggeration");
    // Same capture as "after": otherwise removing the overlays alone could make the frames differ.
    const before = await terrainOnly(page);
    await expect.poll(() => page.locator(".viewer3d").getAttribute("data-exaggeration"), { timeout: 30_000 }).toBe("1.50");
    const after = await pixels(page);
    expect(Number(early)).toBeLessThan(1.5);
    expect(Buffer.compare(Buffer.from(before.rgba), Buffer.from(after.rgba))).not.toBe(0);
    expect(await page.locator(".viewer3d").innerText()).toContain("5,199");
    expect(await page.getByText(/Heights shown/).isVisible()).toBe(true);
    await page.getByRole("button", { name: "Map data", exact: true }).click();
    expect(await page.locator(".viewer3d").innerText()).toContain("Copernicus");
    const canvas = await page.locator(".viewer3d canvas").boundingBox();
    await page.mouse.move(canvas!.x + 80, canvas!.y + 130);
    await page.mouse.down();
    await page.mouse.move(canvas!.x + 200, canvas!.y + 160, { steps: 12 });
    await page.mouse.up();
    const rotated = await pixels(page);
    expect(Buffer.compare(Buffer.from(after.rgba), Buffer.from(rotated.rgba))).not.toBe(0);
    await page.getByRole("button", { name: "Back to map", exact: true }).click();
    expect(await page.locator("svg.map").isVisible()).toBe(true);
    expect(requests.every((url) => new URL(url).origin === new URL(origin).origin)).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  }, 120_000);

  it("opens the whole map with water and no animation under reduced motion", async () => {
    const context = await phoneContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const requests: string[] = [];
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(origin);
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await ready(page);
    expect(await page.locator(".viewer3d").getAttribute("data-mode")).toBe("overview");
    expect(await page.locator(".viewer3d").getAttribute("data-exaggeration")).toBe("3.00");
    await pixels(page);
    expect(requests.some((url) => url.endsWith("/lakes.json"))).toBe(true);
    expect(requests.some((url) => url.endsWith("/rivers.json"))).toBe(true);
    expect(requests.every((url) => new URL(url).origin === new URL(origin).origin)).toBe(true);
    expect(existsSync(join(outDir, ASSETS, "previews"))).toBe(false);
    await page.getByRole("button", { name: "Mount Kenya", exact: true }).click();
    await ready(page);
    expect(await page.locator(".viewer3d").getAttribute("data-mode")).toBe("patch");
    expect(await page.locator(".viewer3d").getAttribute("data-exaggeration")).toBe("1.50");
    expect(errors).toEqual([]);
    await context.close();
  }, 120_000);

  it("preserves 2D when WebGL2 is absent or memory is too low", async () => {
    for (const reason of ["webgl", "memory"]) {
      const context = await browser.newContext();
      await context.addInitScript((reason) => {
        if (reason === "memory") Object.defineProperty(navigator, "deviceMemory", { value: 1 });
        else {
          const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
            return args[0] === "webgl2" ? null : original.apply(this, args);
          } as typeof original;
        }
      }, reason);
      const page = await context.newPage();
      await page.goto(origin);
      await page.getByRole("button", { name: "Mount Kenya", exact: true }).click();
      expect(await page.getByRole("button", { name: "See in 3D", exact: true }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "3D", exact: true }).count()).toBe(0);
      expect(await page.locator("svg.map").isVisible()).toBe(true);
      await context.close();
    }
  });

  it("opens every required patch, lake and river and keeps missions independent", async () => {
    const context = await phoneContext({ reducedMotion: "reduce", viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(origin);
    for (const [name, mode] of [
      ["Mount Elgon", "patch"],
      ["Mount Kilimanjaro (Tanzania)", "patch"],
      ["Great Rift Valley", "patch"],
      ["Lake Victoria", "region"],
      ["Lake Turkana", "region"],
      ["River Tana", "overview"],
    ]) {
      await page.getByRole("button", { name: name!, exact: true }).click();
      await page.getByRole("button", { name: "See in 3D", exact: true }).click();
      await ready(page);
      expect(await page.locator(".viewer3d").getAttribute("data-mode")).toBe(mode);
      await pixels(page);
      await page.getByRole("button", { name: "Back to map", exact: true }).click();
      // The restored fact card must not cover the next map target.
      await page.locator(".fact button.link").click();
    }
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await ready(page);
    await page.getByRole("button", { name: /The map is broken!/ }).click();
    expect(await page.locator("svg.map").isVisible()).toBe(true);
    expect(await page.locator(".viewer3d").count()).toBe(0);
    expect(await page.getByRole("button", { name: "3D", exact: true }).count()).toBe(0);
    expect(errors).toEqual([]);
    await context.close();
  }, 180_000);

  it("reports missing assets and lets the child return to the map", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/3d/manifest.json", (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto(origin);
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await page.getByRole("alert").waitFor();
    expect(await page.getByRole("alert").innerText()).toContain("3D is not available");
    await page.getByRole("button", { name: "Back to map", exact: true }).click();
    expect(await page.locator("svg.map").isVisible()).toBe(true);
    await context.close();
  });
});
