/**
 * E2E (browser): a real production build of the web app offers only teacher-approved lessons
 * (findings register S1; product rule "only approved packs ship to children in production").
 *
 * Today the only pack (Kenya Explorer) is a draft, so:
 *   - a plain production build must offer NO lessons, say truthfully why, and ship none of the
 *     pack's 3D files;
 *   - positive control: the same build with VITE_ALLOW_DRAFT_CONTENT=true (pilot rehearsal) offers
 *     the lessons, labelled as draft, with their 3D files. Without this half, "no lessons" would also
 *     pass if the app were simply broken.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WEB_ROOT = fileURLToPath(new URL("../../../apps/web", import.meta.url));
const PACK_ASSETS = join("content-assets", "ke.g5.sst.kenya-explorer");
/** A sentence that exists only in the draft pack's lessons (a teacher-written explanation). */
const DRAFT_LESSON_TEXT = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../packages/content/packs/kenya-explorer.json", import.meta.url)), "utf8"),
).missions[0].intro.en as string;

/** All JavaScript the build ships, as one string. */
function shippedScripts(outDir: string): string {
  return readdirSync(join(outDir, "assets"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(outDir, "assets", f), "utf8"))
    .join(" ");
}

/** Production build into a fresh folder, with the given extra build environment. */
async function productionBuild(env: Record<string, string | undefined>): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), "dunialab-approved-"));
  const saved = { NODE_ENV: process.env.NODE_ENV, VITE_ALLOW_DRAFT_CONTENT: process.env.VITE_ALLOW_DRAFT_CONTENT };
  process.env.NODE_ENV = "production";
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await build({ root: WEB_ROOT, mode: "production", logLevel: "error", build: { outDir, emptyOutDir: true } });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return outDir;
}

describe("E2E (browser): production builds offer only approved lessons", () => {
  let browser: Browser;
  const dirs: string[] = [];
  const servers: PreviewServer[] = [];

  const open = async (outDir: string) => {
    const server = await preview({ root: WEB_ROOT, logLevel: "error", build: { outDir }, preview: { port: 0, host: "127.0.0.1" } });
    servers.push(server);
    const page = await browser.newPage();
    await page.goto(server.resolvedUrls!.local[0]!);
    return page;
  };

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    for (const s of servers) await s.close();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("a plain production build offers no draft lessons, says why, and ships none of their files", async () => {
    const outDir = await productionBuild({ VITE_ALLOW_DRAFT_CONTENT: undefined });
    dirs.push(outDir);
    const page = await open(outDir);

    await expect.poll(() => page.getByRole("status").innerText()).toMatch(/waiting for teacher approval/);
    expect(await page.getByRole("button", { name: /The map is broken!/ }).count()).toBe(0);
    expect(existsSync(join(outDir, PACK_ASSETS))).toBe(false);
    // Findings register CR2: hidden is not enough. The draft lessons must not be in the files at all.
    expect(DRAFT_LESSON_TEXT.length).toBeGreaterThan(20);
    expect(shippedScripts(outDir).includes(DRAFT_LESSON_TEXT), "draft lesson text in the shipped scripts").toBe(false);
  }, 180_000);

  it("positive control: a rehearsal build that allows drafts offers them, labelled as draft", async () => {
    const outDir = await productionBuild({ VITE_ALLOW_DRAFT_CONTENT: "true" });
    dirs.push(outDir);
    const page = await open(outDir);

    await expect.poll(() => page.getByRole("button", { name: /The map is broken!/ }).count()).toBeGreaterThan(0);
    expect(await page.getByText(/not yet teacher-approved/).isVisible()).toBe(true);
    expect(existsSync(join(outDir, PACK_ASSETS, "3d", "manifest.json"))).toBe(true);
    expect(existsSync(join(outDir, PACK_ASSETS, "3d", "previews"))).toBe(false);
    expect(shippedScripts(outDir).includes(DRAFT_LESSON_TEXT), "draft lesson text in the shipped scripts").toBe(true);
  }, 180_000);
});

describe("E2E (build): an invalid content pack fails the build, loudly", () => {
  it("refuses to build with a broken pack and names the problem; a valid set builds (positive control)", async () => {
    const { cpSync, mkdtempSync: tmp, readFileSync, writeFileSync } = await import("node:fs");
    const packsDir = tmp(join(tmpdir(), "dunialab-packs-"));
    const realPacks = fileURLToPath(new URL("../../../packages/content/packs", import.meta.url));
    cpSync(realPacks, packsDir, { recursive: true });
    const outDir = tmp(join(tmpdir(), "dunialab-badpack-"));
    const saved = process.env.DUNIALAB_PACKS_DIR;
    process.env.DUNIALAB_PACKS_DIR = packsDir;
    try {
      await build({ root: WEB_ROOT, logLevel: "silent", build: { outDir, emptyOutDir: true } });

      const pack = JSON.parse(readFileSync(join(packsDir, "kenya-explorer.json"), "utf8"));
      delete pack.missions;
      writeFileSync(join(packsDir, "kenya-explorer.json"), JSON.stringify(pack));
      await expect(build({ root: WEB_ROOT, logLevel: "silent", build: { outDir, emptyOutDir: true } })).rejects.toThrow(
        /Invalid content pack\(s\)[\s\S]*kenya-explorer\.json/,
      );
    } finally {
      if (saved === undefined) delete process.env.DUNIALAB_PACKS_DIR;
      else process.env.DUNIALAB_PACKS_DIR = saved;
      rmSync(packsDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 240_000);
});

describe("E2E (build): one incomplete pack folder does not break the app (findings register CR40)", () => {
  it("a pack whose 3D manifest is missing builds without its 3D files; the rest of the app still builds", async () => {
    const { cpSync, mkdtempSync: tmp } = await import("node:fs");
    const assets = tmp(join(tmpdir(), "dunialab-assets-"));
    const outDir = tmp(join(tmpdir(), "dunialab-nomanifest-"));
    // A copy of the pack's 3D folder with its manifest removed (a partial download or a bad copy).
    cpSync(join(fileURLToPath(new URL("../../../content-assets/ke.g5.sst.kenya-explorer/3d", import.meta.url)), "lakes.json"), join(assets, "ke.g5.sst.kenya-explorer", "3d", "lakes.json"));
    const saved = { DUNIALAB_ASSETS_DIR: process.env.DUNIALAB_ASSETS_DIR, VITE_ALLOW_DRAFT_CONTENT: process.env.VITE_ALLOW_DRAFT_CONTENT };
    process.env.DUNIALAB_ASSETS_DIR = assets;
    process.env.VITE_ALLOW_DRAFT_CONTENT = "true";
    try {
      await build({ root: WEB_ROOT, logLevel: "silent", build: { outDir, emptyOutDir: true } });
      expect(existsSync(join(outDir, "index.html"))).toBe(true);
      expect(existsSync(join(outDir, PACK_ASSETS))).toBe(false);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(assets, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 240_000);

  it("a pack whose 3D manifest is damaged is skipped the same way (findings register CR95)", async () => {
    const { mkdirSync, mkdtempSync: tmp, writeFileSync } = await import("node:fs");
    const assets = tmp(join(tmpdir(), "dunialab-assets-"));
    const outDir = tmp(join(tmpdir(), "dunialab-badmanifest-"));
    mkdirSync(join(assets, "ke.g5.sst.kenya-explorer", "3d"), { recursive: true });
    writeFileSync(join(assets, "ke.g5.sst.kenya-explorer", "3d", "manifest.json"), "{ truncated");
    const saved = { DUNIALAB_ASSETS_DIR: process.env.DUNIALAB_ASSETS_DIR, VITE_ALLOW_DRAFT_CONTENT: process.env.VITE_ALLOW_DRAFT_CONTENT };
    process.env.DUNIALAB_ASSETS_DIR = assets;
    process.env.VITE_ALLOW_DRAFT_CONTENT = "true";
    try {
      await build({ root: WEB_ROOT, logLevel: "silent", build: { outDir, emptyOutDir: true } });
      expect(existsSync(join(outDir, "index.html"))).toBe(true);
      expect(existsSync(join(outDir, PACK_ASSETS))).toBe(false);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(assets, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 240_000);
});

