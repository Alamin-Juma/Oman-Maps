import { defineConfig, loadEnv, type Plugin } from "vite";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Assets3dManifest, validatePack, type ContentPack } from "@dunialab/content";
import { selectPacks } from "./src/lib/pack-selection.js";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

/**
 * `npm run dev:phone` serves over HTTPS on the LAN so a real phone can open the camera:
 * browsers expose getUserMedia only in a secure context, and a LAN IP over plain HTTP is
 * not one (localhost is exempt). The certificate is self-signed, so the phone shows a
 * one-time warning to accept. Never used for the production build.
 */
const phone = process.env.DUNIALAB_HTTPS === "1";
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** The content packs to build with. DUNIALAB_PACKS_DIR overrides it, for tests only. */
const PACKS_DIR = process.env.DUNIALAB_PACKS_DIR ?? join(repoRoot, "packages", "content", "packs");
const VIRTUAL_PACKS = "virtual:dunialab-packs";

/**
 * Every content pack, validated once by the build, never by the browser.
 *
 * The packs are fixed when the app is built, so validating them again on every page load only
 * shipped the validation library (zod) to every phone: about 29% of the first-load source, which
 * pushed the first load over its data budget. A pack that fails validation now FAILS THE BUILD,
 * with the reasons, instead of silently disappearing from the app.
 */
async function loadValidatedPacks(): Promise<ContentPack[]> {
  const packs: ContentPack[] = [];
  const problems: string[] = [];
  for (const file of (await readdir(PACKS_DIR)).filter((f) => f.endsWith(".json")).sort()) {
    const result = validatePack(JSON.parse(await readFile(join(PACKS_DIR, file), "utf8")));
    if (result.ok && result.pack) packs.push(result.pack);
    else problems.push(`${file}:\n  ${result.issues.join("\n  ")}`);
  }
  if (problems.length) throw new Error(`Invalid content pack(s); fix them or run "npm run validate:content":\n${problems.join("\n")}`);
  return packs;
}

function validatedPacks(): Plugin {
  const resolved = `\0${VIRTUAL_PACKS}`; // the \0 prefix marks a virtual module for Vite
  return {
    name: "dunialab-validated-packs",
    resolveId: (id) => (id === VIRTUAL_PACKS ? resolved : undefined),
    async load(id) {
      if (id !== resolved) return undefined;
      for (const file of await readdir(PACKS_DIR)) if (file.endsWith(".json")) this.addWatchFile(join(PACKS_DIR, file));
      return `export default ${JSON.stringify(await loadValidatedPacks())};`;
    },
  };
}

/**
 * Serves (dev) and copies (build) each pack's generated 3D files from content-assets/.
 * Only packs the app actually offers are included: in a production build that means approved
 * packs only, exactly as lib/packs.ts decides (findings register S1). Previews never ship.
 */
function contentAssets(): Plugin {
  let outDir: string;
  let base: string;
  let production = false;
  let allowDraft = false;
  async function offeredPackIds(): Promise<Set<string>> {
    return new Set(selectPacks(await loadValidatedPacks(), { production, allowDraft }).packs.map((p) => p.id));
  }
  async function files() {
    const root = join(repoRoot, "content-assets");
    const offered = await offeredPackIds();
    const allowed = new Map<string, string>();
    for (const dir of await readdir(root, { withFileTypes: true })) {
      if (!dir.isDirectory() || !offered.has(dir.name)) continue;
      const source = join(root, dir.name, "3d");
      const manifest = Assets3dManifest.parse(JSON.parse(await readFile(join(source, "manifest.json"), "utf8")));
      for (const path of ["manifest.json", ...manifest.files.filter((f) => f.role !== "preview").map((f) => f.path)]) {
        allowed.set(`${dir.name}/3d/${path}`, join(source, path));
      }
    }
    return allowed;
  }
  return {
    name: "dunialab-content-assets",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      base = config.base;
      production = config.isProduction;
      allowDraft = loadEnv(config.mode, config.envDir || config.root, "VITE_").VITE_ALLOW_DRAFT_CONTENT === "true" || process.env.VITE_ALLOW_DRAFT_CONTENT === "true";
    },
    async configureServer(server) {
      const allowed = await files();
      server.middlewares.use(async (req, res, next) => {
        const prefix = `${base}content-assets/`;
        const raw = req.url?.split("?")[0] ?? "";
        if (!raw.startsWith(prefix)) return next();
        let path: string;
        try { path = decodeURIComponent(raw.slice(prefix.length)); }
        catch { res.statusCode = 404; res.end(); return; }
        const source = !path.includes("..") && !path.includes("\\") && req.method === "GET" ? allowed.get(path) : undefined;
        if (!source) { res.statusCode = 404; res.end(); return; }
        try {
          const bytes = await readFile(source);
          res.setHeader("Content-Type", path.endsWith(".webp") ? "image/webp" : "application/json");
          res.end(bytes);
        } catch (error) { next(error); }
      });
    },
    async writeBundle() {
      for (const [path, source] of await files()) {
        const target = join(outDir, "content-assets", path);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), validatedPacks(), contentAssets(), ...(phone ? [basicSsl()] : [])],
  server: { port: 5173, ...(phone ? { host: true } : {}) },
  build: { target: "es2022", sourcemap: true },
  test: { include: ["test/**/*.test.ts"] },
} as Parameters<typeof defineConfig>[0]);
