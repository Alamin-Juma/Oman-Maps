/**
 * E2E: the real geodata command, end to end, without the internet.
 *
 * A local web server plays the part of the open-data buckets: it serves small GeoTIFF files
 * (formula terrain) and supports HTTP range requests and HEAD exactly as S3 does. It also
 * drops the first connection on purpose, the failure seen in the Phase 0 spike. The built
 * CLI (tools/geo/dist/cli.js) then generates, verifies and exports assets for a pack it has
 * never seen, read from a packs folder given on the command line.
 *
 * This proves the slice the unit tests cannot: process start, arguments, range reads through
 * geotiff, retries, the on-disk cache, file output, exit codes.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeArrayBuffer } from "geotiff";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Assets3dManifest, RiversFile } from "@dunialab/content";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CLI = join(ROOT, "tools", "geo", "dist", "cli.js");

/** An island inside the 1-degree square 10-11 E, 20-21 N, with a peak and a valley to the east coast. */
const height = (lon: number, lat: number) => {
  const d = Math.hypot(lon - 10.5, lat - 20.5);
  if (d > 0.42) return 0;
  const cone = Math.max(0, 2400 - Math.hypot(lon - 10.35, lat - 20.5) * 9000);
  const valley = lon > 10.5 ? Math.min(120, Math.abs(lat - 20.45) * 2500) : 120;
  return 15 + (0.42 - d) * 700 + cone + valley;
};

async function geotiff(pixelsPerDegree: number): Promise<Buffer> {
  const n = pixelsPerDegree;
  const values = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) values[j * n + i] = height(10 + (i + 0.5) / n, 21 - (j + 0.5) / n);
  const buffer = (await writeArrayBuffer(values, {
    width: n,
    height: n,
    BitsPerSample: [32],
    SampleFormat: [3],
    ModelPixelScale: [1 / n, 1 / n, 0],
    ModelTiepoint: [0, 0, 0, 10, 21, 0],
    GTModelTypeGeoKey: 2,
    GeographicTypeGeoKey: 4326,
  })) as ArrayBuffer;
  return Buffer.from(buffer);
}

describe("E2E: geodata generator command", () => {
  let server: Server;
  let base = "";
  let work = "";
  const requests = { get: 0, head: 0, dropped: 0, notFound: 0 };

  // Asynchronous on purpose: the fake data server lives in this process, and a blocking
  // spawn would stop it from answering the command it is serving.
  const run = (...args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, ...args, "--out", join(work, "assets"), "--cache", join(work, "cache")], {
        cwd: ROOT,
        env: {
          ...process.env,
          GEO_PACKS_DIR: join(work, "packs"),
          GEO_DEM90_URL: `${base}/dem90`,
          GEO_DEM30_URL: `${base}/dem30`,
          GEO_RIVERS_FILE: join(work, "rivers.geojson"),
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });

  beforeAll(async () => {
    expect(existsSync(CLI), `${CLI} is missing: run "npm run build"`).toBe(true);
    work = mkdtempSync(join(tmpdir(), "dunialab-geo-e2e-"));

    const files: Record<string, Buffer> = {
      "/dem90/Copernicus_DSM_COG_30_N20_00_E010_00_DEM/Copernicus_DSM_COG_30_N20_00_E010_00_DEM.tif": await geotiff(240),
      "/dem30/Copernicus_DSM_COG_10_N20_00_E010_00_DEM/Copernicus_DSM_COG_10_N20_00_E010_00_DEM.tif": await geotiff(720),
    };
    server = createServer((req, res) => {
      const file = files[req.url ?? ""];
      if (!file) {
        requests.notFound++;
        res.writeHead(404).end();
        return;
      }
      if (req.method === "HEAD") {
        requests.head++;
        res.writeHead(200, { "content-length": file.length, "accept-ranges": "bytes" }).end();
        return;
      }
      requests.get++;
      if (requests.dropped === 0) {
        requests.dropped++;
        req.socket.destroy(); // the network drops the first download
        return;
      }
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
      if (!range) {
        res.writeHead(200, { "content-length": file.length }).end(file);
        return;
      }
      const start = Number(range[1]);
      const end = Math.min(file.length - 1, range[2] ? Number(range[2]) : file.length - 1);
      res.writeHead(206, { "content-range": `bytes ${start}-${end}/${file.length}`, "content-length": end - start + 1, "accept-ranges": "bytes" }).end(file.subarray(start, end + 1));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // A pack the generator has never seen, as a file in a folder: a content drop.
    const kenya = JSON.parse(readFileSync(join(ROOT, "packages/content/packs/kenya-explorer.json"), "utf8"));
    const name = (en: string) => ({ en, sw: en });
    mkdirSync(join(work, "packs"));
    writeFileSync(
      join(work, "packs", "island.json"),
      JSON.stringify({
        ...kenya,
        id: "zz.e2e.island",
        printTarget: { ...kenya.printTarget, bounds: [[10, 20], [11, 21]] },
        features: [
          { id: "peak", kind: "mountain", name: name("Peak"), anchor: [10.35, 20.5], facts: [] },
          { id: "east-river", kind: "river", name: name("East River"), anchor: [10.7, 20.45], path: [[10.52, 20.46], [10.95, 20.45]], facts: [] },
        ],
        missions: kenya.missions.map((m: { tasks: { featureId?: string }[] }) => ({ ...m, tasks: m.tasks.map((t) => (t.featureId ? { ...t, featureId: "peak" } : t)) })),
      }),
    );
    // A surveyed line along the valley, so the "guided" path is exercised too.
    writeFileSync(
      join(work, "rivers.geojson"),
      JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[10.5, 20.45], [10.7, 20.45], [10.93, 20.45]] } }] }),
    );
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    if (work) rmSync(work, { recursive: true, force: true });
  });

  const PARAMS = JSON.stringify({ heightSize: 65, textureSize: 64, regionalTextureSize: 64, patchHeightSize: 65, patchTextureSize: 1024, regionalMetresPerPixel: 371 });
  const dir = () => join(work, "assets", "zz.e2e.island", "3d");
  /**
   * The first build, run once by whichever test needs it first. Later tests (cache, verify, Unity)
   * call it too, so each can be run on its own (findings register CR55); the dropped-connection
   * assertions stay with this first build's result.
   */
  let first: ReturnType<typeof run> | undefined;
  const firstBuild = () => (first ??= run("build", "--no-landcover", "--params", PARAMS));

  it("generates verified assets for a new pack, surviving a dropped connection", async () => {
    const result = await firstBuild();
    expect(result.stderr).toBe("");
    expect(result.status, result.stdout).toBe(0);

    expect(requests.dropped).toBe(1);
    expect(result.stdout).toMatch(/network: \d+ requests, .* [1-9]\d* retries/);
    expect(requests.notFound, "neighbouring squares are open sea: the generator must ask and accept 404").toBeGreaterThan(0);

    const manifest = Assets3dManifest.parse(JSON.parse(readFileSync(join(dir(), "manifest.json"), "utf8")));
    expect(manifest.packId).toBe("zz.e2e.island");
    expect(manifest.patches.map((p) => p.featureId)).toEqual(["peak"]);
    expect(manifest.patches[0]!.elevationRange[1]).toBeGreaterThan(2000);
    expect(manifest.sources.map((s) => s.id)).toEqual(["copernicus-dem-glo-30", "copernicus-dem-glo-90", "natural-earth-rivers"]);
    expect(manifest.rivers.items[0]).toMatchObject({ featureId: "east-river", endsIn: "sea", guided: true });

    const river = RiversFile.parse(JSON.parse(readFileSync(join(dir(), "rivers.json"), "utf8"))).rivers[0]!;
    expect(river.points.at(-1)![2]).toBe(0);
    expect(river.points[0]![2]).toBeGreaterThan(50);

    const attribution = readFileSync(join(work, "assets", "ATTRIBUTION.md"), "utf8");
    expect(attribution).toMatch(/Copernicus/);
    expect(attribution).toMatch(/do not incur any liability/);
    expect(attribution).toMatch(/Natural Earth/);
  }, 180_000);

  it("runs a second time from the cache, without touching the network, and writes the same files", async () => {
    expect((await firstBuild()).status).toBe(0);
    const before = readFileSync(join(dir(), "manifest.json"), "utf8");
    const seen = { ...requests };
    const result = await run("build", "--no-landcover", "--params", PARAMS);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(/network: 0 requests/);
    expect(requests).toEqual(seen);
    expect(readFileSync(join(dir(), "manifest.json"), "utf8")).toBe(before);
  }, 180_000);

  it("verifies sound assets, and fails loudly when a file was changed", async () => {
    expect((await firstBuild()).status).toBe(0);
    const ok = await run("verify");
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/: ok/);

    const manifest = Assets3dManifest.parse(JSON.parse(readFileSync(join(dir(), "manifest.json"), "utf8")));
    const victim = join(dir(), manifest.files.find((f) => f.role === "overview-tile")!.path);
    const original = readFileSync(victim);
    appendFileSync(victim, "x");
    const bad = await run("verify");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/fingerprint|bytes/);
    writeFileSync(victim, original);
  }, 120_000);

  it("exports 16-bit RAW heightmaps for Unity from the generated assets", async () => {
    expect((await firstBuild()).status).toBe(0);
    const to = join(work, "unity");
    const result = await run("unity", "--to", to);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const index = JSON.parse(readFileSync(join(to, "zz.e2e.island", "index.json"), "utf8"));
    expect(index.bits).toBe(16);
    const patch = index.heightmaps.find((h: { file: string }) => h.file === "patch_peak.raw");
    expect(patch.size).toBe(65);
    expect(statSync(join(to, "zz.e2e.island", "patch_peak.raw")).size).toBe(65 * 65 * 2);
    expect(patch.maxMetres).toBeGreaterThan(2000);
  }, 120_000);

  it("refuses an unknown pack id with a clear message", async () => {
    const result = await run("build", "--pack", "no.such.pack");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no pack with id no\.such\.pack/);
  }, 60_000);
});
