/**
 * E2E (browser): Tier C web app + real API + real Postgres.
 *   A child plays "The map is broken!" offline on two different days (clock controlled),
 *   sees the skill become Mastered on the device, then a parent signs up, consents,
 *   adds the child, syncs, and reads the weekly report.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseReachable, startApi, type RunningApi } from "../support/server.js";

const WEB_ROOT = fileURLToPath(new URL("../../../apps/web", import.meta.url));
const reachable = await databaseReachable();

const HOUR = 3_600_000;

async function playBrokenMap(page: Page) {
  await page.getByRole("button", { name: /The map is broken!/ }).click();
  await page.getByRole("button", { name: "The title", exact: true }).click();
  await page.getByRole("button", { name: "In the key", exact: true }).click();
  await page.getByRole("button", { name: "The compass", exact: true }).click();
  await page.getByPlaceholder("Write your explanation...").fill(
    "Without a key I cannot tell what the symbols mean and without a scale I cannot work out the distance",
  );
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect.poll(() => page.getByText("Mission complete!").isVisible()).toBe(true);
  await page.getByRole("button", { name: "Back to missions" }).click();
}

describe.skipIf(!reachable)("E2E (browser): Tier C two-day mastery, then parent sync and report", () => {
  let api: RunningApi;
  let web: PreviewServer;
  let browser: Browser;
  let outDir = "";

  beforeAll(async () => {
    api = await startApi();
    outDir = mkdtempSync(join(tmpdir(), "dunialab-web-"));
    process.env.VITE_API_URL = api.url;
    await build({ root: WEB_ROOT, logLevel: "error", build: { outDir, emptyOutDir: true } });
    web = await preview({ root: WEB_ROOT, logLevel: "error", build: { outDir }, preview: { port: 0, host: "127.0.0.1" } });
    browser = await chromium.launch();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await web?.close();
    await api?.stop();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("plays offline on two days, masters the skill, then syncs and reports", async () => {
    const page = await browser.newPage();
    const url = web.resolvedUrls!.local[0]!;
    const now = Date.now();

    // Day 1 (yesterday)
    await page.clock.setFixedTime(new Date(now - 25 * HOUR));
    await page.goto(url);
    await playBrokenMap(page);
    const skill = page.locator(".skills li", { hasText: "Knows the parts of a map" });
    await expect.poll(() => skill.textContent()).toContain("Practising");

    // Day 2 (today): same mission again. Correct on two days + an explanation = Mastered
    await page.clock.setFixedTime(new Date(now - 1 * HOUR));
    await playBrokenMap(page);
    await expect.poll(() => skill.textContent()).toContain("Mastered");

    // Parent signs up, consents, adds the child, and syncs the offline events.
    await page.getByPlaceholder("email").fill(`web-e2e-${now}@example.com`);
    await page.getByPlaceholder("password (10+ characters)").fill("a long enough password");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("checkbox").check();
    await page.getByPlaceholder("Child's nickname").fill("Amani");
    for (const pic of ["lion", "mango", "drum"]) await page.getByRole("button", { name: pic, exact: true }).click();
    await page.getByRole("button", { name: "Add child" }).click();

    await page.getByRole("button", { name: /Sync now \(8\)/ }).click();
    await expect.poll(() => page.getByText(/Synced: 8 new, 0 already saved/).isVisible()).toBe(true);

    await page.getByRole("button", { name: "Weekly report" }).click();
    const line = page.locator(".report .skills li", { hasText: "Knows the parts of a map" });
    await expect.poll(() => line.textContent()).toContain("★ mastered");
  });

  it("a locate task is answered by tapping the feature on the 2D map", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // phone-sized
    await page.goto(web.resolvedUrls!.local[0]!);
    await page.getByRole("button", { name: /Expedition: the mountains/ }).click();
    await page.getByRole("button", { name: "Mount Kenya", exact: true }).click(); // the map feature (SVG role=button)
    await expect.poll(() => page.locator(".banner.good").textContent()).toContain("central highlands");
    await page.getByRole("button", { name: "Mount Kenya", exact: true }).first().waitFor();
    expect(await page.locator(".progress").textContent()).toBe("2 / 4");
  });
});
