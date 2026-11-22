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
    await call(api.url, "POST", "/v1/profiles", { nickname: "Baraka", grade: 5, picturePin: ["sun", "fish", "ball"] }, token);

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
    let childListRequests = 0;
    const { page, close } = await openSignedIn(token, async (p) => {
      p.on("request", (r) => {
        if (r.method() === "GET" && r.url().endsWith("/v1/profiles")) childListRequests++;
      });
    });
    await expect.poll(() => childOption(page).count()).toBe(1);
    expect(await page.getByText(/sign-in has ended/).count()).toBe(0);
    // Ledger TC6, re-audited: on paid mobile data the app must not fetch the same list twice.
    await page.waitForTimeout(1000);
    expect(childListRequests).toBe(1);
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
    let familyAAnswered = 0;
    const { page, close } = await openSignedIn(token, async (p) => {
      p.on("requestfinished", (r) => {
        if (r.method() === "GET" && r.url().endsWith("/v1/profiles") && r.headers().authorization === `Bearer ${token}`) familyAAnswered++;
      });
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
    // Wait for the condition, not a fixed time (findings register CR49): A's answer has really arrived.
    await expect.poll(() => familyAAnswered).toBe(1);

    await page.getByPlaceholder("email").fill(emailB);
    await page.getByPlaceholder(/password/).fill("another long password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect.poll(() => page.getByRole("button", { name: "Sign out" }).isVisible()).toBe(true);
    // Family B's own list is still loading (it never arrives), and the screen says so (CR33).
    await expect.poll(() => page.getByRole("status").filter({ hasText: /Loading children/ }).isVisible()).toBe(true);

    expect(await childOption(page).count()).toBe(0);
    await close();
  });

  // ---------- First CodeRabbit review: screens tell the truth (CLAUDE.md §5) ----------

  it("the children list shows loading, then a failure with a retry; neither offers 'Add child' (findings register CR33)", async () => {
    let mode: "hold" | "fail" | "pass" = "hold";
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const { page, close } = await openSignedIn(token, async (p) => {
      await p.route("**/v1/profiles", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        if (mode === "hold") {
          await held;
          mode = "pass";
          return route.fulfill({ status: 500, body: JSON.stringify({ message: "boom" }) });
        }
        return route.continue();
      });
    });
    await expect.poll(() => page.getByRole("status").filter({ hasText: /Loading children/ }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Add child" }).count()).toBe(0);

    release(); // the list request fails
    await expect.poll(() => page.getByRole("alert").filter({ hasText: /could not load/i }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Add child" }).count()).toBe(0);

    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => childOption(page).count()).toBe(1);
    await close();
  });

  it("positive control: a family with no children is offered 'Add child'", async () => {
    const empty = await call<{ token: string }>(api.url, "POST", "/v1/auth/register", { email: `e2e-empty-${randomUUID()}@example.com`, password: "a long enough password" });
    const { page, close } = await openSignedIn(empty.body.token);
    await expect.poll(() => page.getByRole("button", { name: "Add child" }).isVisible()).toBe(true);
    await close();
  });

  it("the parent area's selectors have names a screen reader can say (findings register CR35)", async () => {
    const { page, close } = await openSignedIn(token);
    await expect.poll(() => page.getByRole("combobox", { name: "Child" }).isVisible()).toBe(true);
    await close();
  });

  it("a report belongs to one child: switching child hides it, and a late answer for the first child is dropped (findings register CR34)", async () => {
    let holdNext = false;
    let release: () => void = () => {};
    const { page, close } = await openSignedIn(token, async (p) => {
      await p.route("**/v1/profiles/*/report**", async (route) => {
        if (holdNext) {
          holdNext = false;
          await new Promise<void>((r) => (release = r));
        }
        return route.continue();
      });
    });
    const child = page.getByRole("combobox", { name: "Child" });
    await expect.poll(() => childOption(page).count()).toBe(1);
    const options = await child.locator("option").allTextContents();
    const amani = (await child.locator("option", { hasText: "Amani" }).getAttribute("value"))!;
    const baraka = (await child.locator("option", { hasText: "Baraka" }).getAttribute("value"))!;
    expect(options.length).toBe(3);

    // Positive control: Amani's report shows for Amani.
    await child.selectOption(amani);
    await page.getByRole("button", { name: "Weekly report" }).click();
    await expect.poll(() => page.locator(".report h4").textContent()).toMatch(/^Amani:/);

    // Switching child hides it.
    await child.selectOption(baraka);
    await expect.poll(() => page.locator(".report").count()).toBe(0);

    // A late answer for Amani, arriving after the switch to Baraka, is not shown.
    await child.selectOption(amani);
    holdNext = true;
    await page.getByRole("button", { name: "Weekly report" }).click();
    await child.selectOption(baraka);
    release();
    await page.getByRole("button", { name: "Weekly report" }).click();
    await expect.poll(() => page.locator(".report h4").textContent()).toMatch(/^Baraka:/);
    expect(await page.locator(".report h4").textContent()).not.toMatch(/^Amani:/);
    await close();
  });

  it("pressing Sign in twice sends one sign-in, so a late one cannot come back after sign-out (findings register CR6)", async () => {
    const email = `e2e-twice-${randomUUID()}@example.com`;
    await call(api.url, "POST", "/v1/auth/register", { email, password: "a long enough password" });
    const context = await browser.newContext();
    const page = await context.newPage();
    let logins = 0;
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/v1/auth/login", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      logins++;
      await held;
      return route.continue();
    });
    await page.goto(web.resolvedUrls!.local[0]!);
    await page.getByPlaceholder("email").fill(email);
    await page.getByPlaceholder(/password/).fill("a long enough password");
    const signIn = page.getByRole("button", { name: "Sign in" });
    await signIn.click();
    await signIn.click({ force: true }).catch(() => {}); // a second, impatient press
    await page.waitForTimeout(300);
    expect(logins).toBe(1);
    release();
    await expect.poll(() => page.getByRole("button", { name: "Sign out" }).isVisible()).toBe(true);
    await context.close();
  });

  it("an explanation answered after the child changed is dropped, never saved under the old child (findings register CR24)", async () => {
    let release: () => void = () => {};
    let checks = 0;
    const { page, close } = await openSignedIn(token, async (p) => {
      await p.route("**/v1/explanations/check", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        checks++;
        await new Promise<void>((r) => (release = r));
        return route.continue();
      });
    });
    const child = page.getByRole("combobox", { name: "Child" });
    await expect.poll(() => childOption(page).count()).toBe(1);
    const amani = (await child.locator("option", { hasText: "Amani" }).getAttribute("value"))!;
    const baraka = (await child.locator("option", { hasText: "Baraka" }).getAttribute("value"))!;
    await child.selectOption(amani);

    await page.getByRole("button", { name: /The map is broken!/ }).click();
    await page.getByRole("button", { name: "The title", exact: true }).click();
    await page.getByRole("button", { name: "In the key", exact: true }).click();
    await page.getByRole("button", { name: "The compass", exact: true }).click();
    await page.getByPlaceholder("Write your explanation...").fill("Without a key I cannot tell what the symbols mean and without a scale I cannot work out the distance");
    await page.getByRole("button", { name: "Check my answer" }).click();
    await expect.poll(() => checks).toBe(1);

    await child.selectOption(baraka); // the mission now belongs to another child
    release(); // Amani's explanation result arrives late
    await page.waitForTimeout(1500);

    const explainFor = await page.evaluate((id) => {
      const saved = JSON.parse(localStorage.getItem("dunialab.events.v1") ?? "[]") as Array<{ event: { profileId: string; kind: string } }>;
      return saved.filter((s) => s.event.kind === "explain" && s.event.profileId === id).length;
    }, amani);
    const choicesFor = await page.evaluate((id) => {
      const saved = JSON.parse(localStorage.getItem("dunialab.events.v1") ?? "[]") as Array<{ event: { profileId: string; kind: string } }>;
      return saved.filter((s) => s.event.kind === "choice" && s.event.profileId === id).length;
    }, amani);
    expect(choicesFor).toBe(3); // positive control: what Amani did before the switch is kept
    expect(explainFor).toBe(0);
    await close();
  });
});

