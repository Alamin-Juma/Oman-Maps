/**
 * Remote geodata sources against a local server (findings register CR70-CR74, first CodeRabbit review).
 * tools/geo does I/O by design, so these tests use a real HTTP server and real cache folders.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeArrayBuffer } from "geotiff";
import { afterEach, describe, expect, it } from "vitest";
import { copernicusDem, installRetryingFetch, naturalEarthRivers, newNetworkStats } from "../src/remote.js";

/** A one-degree GeoTIFF over 10-11 E, 20-21 N, every sample `value`. */
async function flatTiff(pixelsPerDegree: number, value: number): Promise<Buffer> {
  const n = pixelsPerDegree;
  const buffer = (await writeArrayBuffer(new Float32Array(n * n).fill(value), {
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

const GLO90 = "/Copernicus_DSM_COG_30_N20_00_E010_00_DEM/Copernicus_DSM_COG_30_N20_00_E010_00_DEM.tif";
const GLO30 = "/Copernicus_DSM_COG_10_N20_00_E010_00_DEM/Copernicus_DSM_COG_10_N20_00_E010_00_DEM.tif";
const BOX: [[number, number], [number, number]] = [[10.2, 20.2], [10.8, 20.8]];

interface Site {
  base: string;
  hits: string[];
  /** path -> file, or a status code to answer with. */
  files: Map<string, Buffer | number>;
}
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function site(files: Record<string, Buffer | number>): Promise<Site> {
  const map = new Map(Object.entries(files));
  const hits: string[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    hits.push(`${req.method} ${url}`);
    const file = map.get(url);
    if (file === undefined) return void res.writeHead(404).end();
    if (typeof file === "number") return void res.writeHead(file).end("denied");
    if (req.method === "HEAD") return void res.writeHead(200, { "content-length": file.length }).end();
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (!range) return void res.writeHead(200, { "content-length": file.length }).end(file);
    const start = Number(range[1]);
    const end = Math.min(file.length - 1, range[2] ? Number(range[2]) : file.length - 1);
    res.writeHead(206, { "content-range": `bytes ${start}-${end}/${file.length}`, "content-length": end - start + 1 }).end(file.subarray(start, end + 1));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits, files: map };
}
const cacheDir = () => {
  const d = mkdtempSync(join(tmpdir(), "dunialab-remote-"));
  dirs.push(d);
  return d;
};
const maxOf = (data: ArrayLike<number>) => {
  let m = -Infinity;
  for (let i = 0; i < data.length; i++) m = Math.max(m, data[i]!);
  return m;
};

describe("Copernicus elevation", () => {
  it("does not remember an access refusal (403) as 'no terrain here' (CR70)", async () => {
    const s = await site({ [GLO90]: 403 });
    const cache = cacheDir();
    const first = await copernicusDem({ cacheDir: cache, baseUrl90: s.base, baseUrl30: s.base }).read(BOX, 371);
    expect(maxOf(first.data)).toBe(0); // nothing could be read this time
    s.files.set(GLO90, await flatTiff(240, 500)); // the mirror's access is corrected
    const second = await copernicusDem({ cacheDir: cache, baseUrl90: s.base, baseUrl30: s.base }).read(BOX, 371);
    expect(maxOf(second.data)).toBe(500);
  });

  it("positive control: a confirmed absence (404, open sea) is remembered, so a warm run asks nothing", async () => {
    const s = await site({});
    const cache = cacheDir();
    await copernicusDem({ cacheDir: cache, baseUrl90: s.base, baseUrl30: s.base }).read(BOX, 371);
    const asked = s.hits.length;
    expect(asked).toBeGreaterThan(0);
    await copernicusDem({ cacheDir: cache, baseUrl90: s.base, baseUrl30: s.base }).read(BOX, 371);
    expect(s.hits.length).toBe(asked);
  });

  it("never answers from another source's cache when the mirror changes (CR71)", async () => {
    const a = await site({ [GLO90]: await flatTiff(240, 100) });
    const b = await site({ [GLO90]: await flatTiff(240, 900) });
    const cache = cacheDir();
    const fromA = await copernicusDem({ cacheDir: cache, baseUrl90: a.base, baseUrl30: a.base }).read(BOX, 371);
    const fromB = await copernicusDem({ cacheDir: cache, baseUrl90: b.base, baseUrl30: b.base }).read(BOX, 371);
    expect(maxOf(fromA.data)).toBe(100);
    expect(maxOf(fromB.data)).toBe(900);
    // ...and going back to the first source reuses its own cache without the network.
    const asked = a.hits.length;
    const again = await copernicusDem({ cacheDir: cache, baseUrl90: a.base, baseUrl30: a.base }).read(BOX, 371);
    expect(maxOf(again.data)).toBe(100);
    expect(a.hits.length).toBe(asked);
  });

  it("uses the 90 m tile where the 30 m product has none on land, and credits it (CR72)", async () => {
    const s = await site({ [GLO90]: await flatTiff(240, 700) }); // no GLO-30 file at all
    const source = copernicusDem({ cacheDir: cacheDir(), baseUrl90: s.base, baseUrl30: s.base });
    const grid = await source.read(BOX, 31);
    expect(maxOf(grid.data)).toBe(700);
    expect(source.used().map((u) => u.id)).toContain("copernicus-dem-glo-90");
  });

  it("positive control: where the 30 m tile exists it is used", async () => {
    const s = await site({ [GLO90]: await flatTiff(240, 700), [GLO30]: await flatTiff(720, 300) });
    const source = copernicusDem({ cacheDir: cacheDir(), baseUrl90: s.base, baseUrl30: s.base });
    expect(maxOf((await source.read(BOX, 31)).data)).toBe(300);
    expect(source.used().map((u) => u.id)).toEqual(["copernicus-dem-glo-30"]);
  });
});

describe("Natural Earth guide lines (CR73)", () => {
  const good = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[10.3, 20.5], [10.7, 20.5]] } }] });
  const rough: [number, number][] = [[10.3, 20.5], [10.7, 20.5]];

  it("does not keep a damaged download, and a later run downloads it again", async () => {
    const s = await site({ "/rivers.geojson": Buffer.from(good.slice(0, 40)) }); // truncated
    const cache = cacheDir();
    await expect(naturalEarthRivers({ cacheDir: cache, baseUrl: `${s.base}/rivers.geojson` }).linesNear(rough, 10)).rejects.toThrow(/Natural Earth/);
    s.files.set("/rivers.geojson", Buffer.from(good));
    expect(await naturalEarthRivers({ cacheDir: cache, baseUrl: `${s.base}/rivers.geojson` }).linesNear(rough, 10)).toHaveLength(1);
  });

  it("refuses a line with a missing position", async () => {
    const bad = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[10.3, 20.5], null] } }] });
    const s = await site({ "/rivers.geojson": Buffer.from(bad) });
    await expect(naturalEarthRivers({ cacheDir: cacheDir(), baseUrl: `${s.base}/rivers.geojson` }).linesNear(rough, 10)).rejects.toThrow(/position/);
  });

  it("replaces a damaged file already in the cache", async () => {
    const s = await site({ "/rivers.geojson": Buffer.from(good) });
    const cache = cacheDir();
    const source = () => naturalEarthRivers({ cacheDir: cache, baseUrl: `${s.base}/rivers.geojson` });
    await source().linesNear(rough, 10); // fills the cache
    const cached = join(cache, "natural-earth");
    expect(existsSync(cached)).toBe(true);
    for (const f of (await import("node:fs")).readdirSync(cached, { recursive: true, encoding: "utf8" })) {
      if (f.endsWith(".geojson")) writeFileSync(join(cached, f), "{ broken");
    }
    expect(await source().linesNear(rough, 10)).toHaveLength(1);
  });
});

describe("retrying fetch (CR74)", () => {
  it("releases a failed server answer's body before retrying", async () => {
    const original = globalThis.fetch;
    let cancelled = 0;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) {
        const body = new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(1024)), cancel: () => void cancelled++ });
        return new Response(body, { status: 503 });
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const restore = installRetryingFetch(newNetworkStats(), 2);
    try {
      const res = await fetch("http://example.invalid/x");
      expect(await res.text()).toBe("ok");
      expect(cancelled).toBe(1);
    } finally {
      restore();
      globalThis.fetch = original;
    }
  }, 20_000);
});
