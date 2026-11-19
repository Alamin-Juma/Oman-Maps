/**
 * E2E (browser): when the phone's storage refuses to save, the child keeps their progress for the
 * session and the app says it is not saved (findings register R1). Before the fix, progress
 * vanished with no message at all.
 *
 * Storage failure is simulated the way it happens on a full phone: localStorage.setItem throws
 * QuotaExceededError for the progress key. Positive control: with storage working, no warning.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WEB_ROOT = fileURLToPath(new URL("../../../apps/web", import.meta.url));

async function answerFirstTask(page: Page) {
  await page.getByRole("button", { name: /The map is broken!/ }).click();
  await page.getByRole("button", { name: "The title", exact: true }).click();
}

describe("E2E (browser): progress is never lost silently", () => {
  let web: PreviewServer;
  let browser: Browser;
  let outDir = "";

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "dunialab-notsaved-"));
    // The only pack is still a draft; this is a rehearsal build that allows it (findings register S1).
    process.env.VITE_ALLOW_DRAFT_CONTENT = "true";
    await build({ root: WEB_ROOT, logLevel: "error", build: { outDir, emptyOutDir: true } });
    web = await preview({ root: WEB_ROOT, logLevel: "error", build: { outDir }, preview: { port: 0, host: "127.0.0.1" } });
    browser = await chromium.launch();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await web?.close();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("positive control: with storage working there is no warning", async () => {
    const page = await browser.newPage();
    await page.goto(web.resolvedUrls!.local[0]!);
    await answerFirstTask(page);
    await expect.poll(() => page.evaluate(() => (localStorage.getItem("dunialab.events.v1") ?? "").length)).toBeGreaterThan(2);
    expect(await page.getByText(/not saved on this phone/).count()).toBe(0);
    await page.close();
  });

  it("with storage full, the answer still counts and the child is told it is not saved", async () => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (key === "dunialab.events.v1") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    const page = await context.newPage();
    await page.goto(web.resolvedUrls!.local[0]!);
    await answerFirstTask(page);

    await expect.poll(() => page.getByRole("alert").filter({ hasText: /not saved on this phone/ }).isVisible()).toBe(true);
    // Nothing reached storage, yet the session still holds the answer and the mission carries on.
    expect(await page.evaluate(() => localStorage.getItem("dunialab.events.v1"))).toBeNull();
    expect(await page.getByRole("button", { name: "In the key", exact: true }).isVisible()).toBe(true);
    await context.close();
  });
});
