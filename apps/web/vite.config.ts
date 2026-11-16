import { defineConfig, type Plugin } from "vite";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Assets3dManifest } from "@dunialab/content";
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

function contentAssets(): Plugin {
  let outDir: string;
  let base: string;
  async function files() {
    const root = join(repoRoot, "content-assets");
    const allowed = new Map<string, string>();
    for (const dir of await readdir(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
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
  plugins: [react(), contentAssets(), ...(phone ? [basicSsl()] : [])],
  server: { port: 5173, ...(phone ? { host: true } : {}) },
  build: { target: "es2022", sourcemap: true },
  test: { include: ["test/**/*.test.ts"] },
} as Parameters<typeof defineConfig>[0]);
