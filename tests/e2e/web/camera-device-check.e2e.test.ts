/**
 * E2E (browser): the camera device check really opens a camera and shows a frame.
 *
 * Chromium is launched with a synthetic camera (`--use-fake-device-for-media-stream`),
 * which produces a real, moving MediaStream — so this exercises getUserMedia, the <video>
 * element and the canvas capture, not a mock of them.
 *
 * It also guards the product's privacy boundary: "No camera image leaves the device."
 * Every request the page makes is recorded; none may carry the captured frame.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Request } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WEB_ROOT = fileURLToPath(new URL("../../../apps/web", import.meta.url));

describe("E2E (browser): camera device check", () => {
  let web: PreviewServer;
  let browser: Browser;
  let outDir = "";

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "dunialab-camera-"));
    // The only pack is still a draft; this is a rehearsal build that allows it, labelled as draft
    // (findings register S1). tests/e2e/web/approved-content.e2e.test.ts covers the real rule.
    process.env.VITE_ALLOW_DRAFT_CONTENT = "true";
    await build({ root: WEB_ROOT, logLevel: "error", build: { outDir, emptyOutDir: true } });
    web = await preview({ root: WEB_ROOT, logLevel: "error", build: { outDir }, preview: { port: 0, host: "127.0.0.1" } });
    browser = await chromium.launch({
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await web?.close();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("opens the camera, shows the live view, and captures a still without uploading it", async () => {
    const context = await browser.newContext({ permissions: ["camera"] });
    const page = await context.newPage();
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));

    // 127.0.0.1 is a secure context, so no certificate is needed for the check itself.
    await page.goto(`${web.resolvedUrls!.local[0]!}?check=camera`);
    await expect.poll(() => page.getByRole("heading", { name: /Camera check/ }).isVisible()).toBe(true);

    await page.getByRole("button", { name: "Start camera" }).click();

    await expect
      .poll(() => page.getByText(/Camera is live/).isVisible(), { timeout: 20_000 })
      .toBe(true);

    // The <video> is actually decoding frames from the synthetic camera.
    const size = await page.locator("video").evaluate((v) => {
      const el = v as HTMLVideoElement;
      return { w: el.videoWidth, h: el.videoHeight, ended: el.ended };
    });
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);
    expect(size.ended).toBe(false);

    await page.getByRole("button", { name: "Take picture" }).click();
    await expect.poll(() => page.getByText(/Captured on this device/).isVisible()).toBe(true);

    // The still is a real, non-empty JPEG held in the page only.
    const still = await page.locator("img[alt='Captured on this device']").evaluate((img) => {
      const el = img as HTMLImageElement;
      return { src: el.src.slice(0, 32), length: el.src.length, decoded: el.naturalWidth };
    });
    expect(still.src).toContain("data:image/jpeg;base64,");
    expect(still.length).toBeGreaterThan(1000);
    expect(still.decoded).toBeGreaterThan(0);

    // Privacy boundary: nothing was posted anywhere, and no request carried image data.
    const uploads = requests.filter((r) => r.method() !== "GET");
    expect(uploads.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
    for (const request of requests) expect(request.postData() ?? "").not.toContain("image/jpeg");

    await context.close();
  }, 120_000);

  it("tells the tester to use HTTPS when the page is opened on a plain-HTTP LAN address", async () => {
    // A non-loopback host over http is not a secure context, so the camera API is absent.
    // Playwright can route a hostname to the local server, reproducing exactly what a phone sees.
    const local = new URL(web.resolvedUrls!.local[0]!);
    const context = await browser.newContext();
    await context.route("http://dunialab.test/**", async (route) => {
      const target = new URL(route.request().url());
      target.protocol = "http:";
      target.host = local.host;
      await route.continue({ url: target.toString() });
    });
    const page = await context.newPage();

    await page.goto("http://dunialab.test/?check=camera");
    await expect.poll(() => page.getByRole("alert").isVisible()).toBe(true);
    const message = await page.getByRole("alert").innerText();
    expect(message).toMatch(/https/i);
    expect(await page.getByRole("button", { name: "Start camera" }).count()).toBe(0);

    await context.close();
  }, 120_000);
});
