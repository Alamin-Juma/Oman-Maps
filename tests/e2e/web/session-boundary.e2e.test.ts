/**
 * E2E (browser + real API + Postgres): the end of a parent's sign-in is a clean boundary on a
 * shared phone (findings register S7, S8).
 *
 *   S8 - a sign-in the server no longer accepts ends in a clean sign-out with a message, not a
 *        raw "401" while the app still looks signed in.
 *   S7 - an answer that arrives after sign-out does not bring the previous family's children back.
 * Each has a positive control, so "nothing shown" cannot pass just because nothing ever loads.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, databaseReachable, startApi, type RunningApi } from "../support/server.js";

const WEB_ROOT = fileURLToPath(new URL("../../../apps/web", import.meta.url));
const reachable = await databaseReachable();

describe.skipIf(!reachable)("E2E (browser): sign-out and expired sign-ins on a shared phone", () => {
  let api: RunningApi;
  let web: PreviewServer;
  let browser: Browser;
  let outDir = "";
  let token = "";

  beforeAll(async () => {
    api = await startApi();
    const reg = await call<{ token: string }>(api.url, "POST", "/v1/auth/register", { email: `e2e-${randomUUID()}@example.com`, password: "a long enough password" });
    token = reg.body.token;
    await call(api.url, "POST", "/v1/consents", { policyVersion: "2026-11", accepted: true }, token);
    await call(api.url, "POST", "/v1/profiles", { nickname: "Amani", grade: 5, picturePin: ["lion", "mango", "drum"] }, token);

    outDir = mkdtempSync(join(tmpdir(), "dunialab-session-"));
    process.env.VITE_API_URL = api.url;
    // The only pack is still a draft; this is a rehearsal build that allows it (findings register S1).
    process.env.VITE_ALLOW_DRAFT_CONTENT = "true";
    // Build what ships: under Vitest NODE_ENV is "test", which bundles React's development mode
    // (StrictMode then runs every effect twice). Same trap as tests/e2e/web/bundle-budget.
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await build({ root: WEB_ROOT, mode: "production", logLevel: "error", build: { outDir, emptyOutDir: true } });
    } finally {
      process.env.NODE_ENV = previous;
    }
    web = await preview({ root: WEB_ROOT, logLevel: "error", build: { outDir }, preview: { port: 0, host: "127.0.0.1" } });
    browser = await chromium.launch();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await web?.close();
    await api?.stop();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  /** Open the app with this token already saved on the phone. */
  async function openSignedIn(savedToken: string, prepare?: (page: Page) => Promise<void>) {
    const context = await browser.newContext();
    await context.addInitScript((t) => localStorage.setItem("dunialab.token", t), savedToken);
    const page = await context.newPage();
    await prepare?.(page);
    await page.goto(web.resolvedUrls!.local[0]!);
    return { page, close: () => context.close() };
  }

  const childOption = (page: Page) => page.getByRole("option", { name: /Amani/ });

  it("positive control: a valid sign-in loads the family's child, with no notice", async () => {
    const { page, close } = await openSignedIn(token);
    await expect.poll(() => childOption(page).count()).toBe(1);
    expect(await page.getByText(/sign-in has ended/).count()).toBe(0);
    await close();
  });

  it("a sign-in the server no longer accepts ends cleanly, with a message", async () => {
    const { page, close } = await openSignedIn("not-a-valid-token");
    await expect.poll(() => page.getByRole("alert").filter({ hasText: /sign-in has ended/ }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Sign in" }).isVisible()).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("dunialab.token"))).toBeNull();
    expect(await page.getByText(/^401/).count()).toBe(0);
    await close();
  });

  it("an answer that arrives after sign-out never shows the previous family's child to the next parent", async () => {
    // Family B signs in next on the same phone. Their own children list never arrives, so anything
    // shown in the list can only be family A's late answer leaking through.
    const emailB = `e2e-b-${randomUUID()}@example.com`;
    await call(api.url, "POST", "/v1/auth/register", { email: emailB, password: "another long password" });

    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let familyARequests = 0;
    const { page, close } = await openSignedIn(token, async (p) => {
      await p.route("**/v1/profiles", async (route) => {
        // A cross-origin preflight (OPTIONS) passes straight through.
        if (route.request().method() !== "GET") return route.continue();
        if (route.request().headers().authorization === `Bearer ${token}`) {
          familyARequests++;
          await gate; // family A's answer: held until after sign-out
          return route.continue();
        }
        // family B's answer: never arrives
      });
    });
    await expect.poll(() => familyARequests).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Sign out" }).click();
    release(); // family A's answer lands after sign-out
    await page.waitForTimeout(1000);

    await page.getByPlaceholder("email").fill(emailB);
    await page.getByPlaceholder(/password/).fill("another long password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect.poll(() => page.getByRole("button", { name: "Sign out" }).isVisible()).toBe(true);
    await page.waitForTimeout(1000);

    expect(await childOption(page).count()).toBe(0);
    await close();
  });
});
