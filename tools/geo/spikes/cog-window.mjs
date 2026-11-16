#!/usr/bin/env node
/**
 * Phase 0 spike (docs/briefs/3d-explorer.md, ADR-0009): can we read ONE window of a
 * Copernicus DEM tile with HTTP range requests from Node on Windows, without downloading
 * the whole file — and what does it cost in bytes?
 *
 * It reads a square window around a point from the GLO-30 Cloud-Optimised GeoTIFF on the
 * AWS Open Data bucket (public HTTPS, no account), counts every byte that crosses the
 * network, and prints the result as JSON. Nothing is written to disk.
 *
 * Usage:  npm run spike:cog -w @dunialab/geo
 *         node tools/geo/spikes/cog-window.mjs [lon] [lat] [sizeKm]
 * Default point: 37.308, -0.152 (the Mount Kenya anchor in the Kenya Explorer pack), 40 km.
 *
 * This is a spike: it takes coordinates as arguments and knows nothing about packs.
 * The real generator (Phase 1) reads every pack's bounds and features instead.
 */
import { fromUrl } from "geotiff";

const lon = Number(process.argv[2] ?? 37.308);
const lat = Number(process.argv[3] ?? -0.152);
const sizeKm = Number(process.argv[4] ?? 40);

/** Copernicus DEM tiles are 1 x 1 degree, named by their south-west corner. */
function tileUrl(lon, lat, arcsec /* 10 = GLO-30, 30 = GLO-90 */) {
  const south = Math.floor(lat);
  const west = Math.floor(lon);
  const ns = `${south < 0 ? "S" : "N"}${String(Math.abs(south)).padStart(2, "0")}_00`;
  const ew = `${west < 0 ? "W" : "E"}${String(Math.abs(west)).padStart(3, "0")}_00`;
  const name = `Copernicus_DSM_COG_${arcsec}_${ns}_${ew}_DEM`;
  const bucket = arcsec === 10 ? "copernicus-dem-30m" : "copernicus-dem-90m";
  return `https://${bucket}.s3.amazonaws.com/${name}/${name}.tif`;
}

// Count every request and byte: geotiff.js uses the global fetch.
// Connections to S3 are occasionally reset mid-read (seen on the first run of this spike),
// so every request is retried with a short backoff. Retries are counted.
const net = { requests: 0, bytes: 0, ranges: [], retries: 0 };
const rawFetch = globalThis.fetch;
const realFetch = async (input, init) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await rawFetch(input, init);
      const body = await response.arrayBuffer();
      return new Response(init?.method === "HEAD" ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      if (attempt >= 3) throw error;
      net.retries++;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
};
globalThis.fetch = async (input, init) => {
  const response = await realFetch(input, init);
  const body = await response.arrayBuffer();
  net.requests++;
  net.bytes += body.byteLength;
  const range = new Headers(init?.headers).get("range");
  if (range) net.ranges.push(range.replace("bytes=", ""));
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
};

const url = tileUrl(lon, lat, 10);
const started = performance.now();

const head = await realFetch(url, { method: "HEAD" });
if (!head.ok) throw new Error(`HEAD ${url} -> ${head.status}`);
const fileBytes = Number(head.headers.get("content-length"));

const tiff = await fromUrl(url);
const image = await tiff.getImage(0);
const imageCount = await tiff.getImageCount();
const [originX, originY] = image.getOrigin();
const [resX, resY] = image.getResolution(); // resY is negative (north-up)
const width = image.getWidth();
const height = image.getHeight();
const headerBytes = net.bytes;

// Window: sizeKm square centred on the point, clamped to this tile.
const kmPerDegLat = 110.574;
const kmPerDegLon = 111.32 * Math.cos((lat * Math.PI) / 180);
const halfLon = sizeKm / 2 / kmPerDegLon;
const halfLat = sizeKm / 2 / kmPerDegLat;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const x0 = clamp(Math.floor((lon - halfLon - originX) / resX), 0, width);
const x1 = clamp(Math.ceil((lon + halfLon - originX) / resX), 0, width);
const y0 = clamp(Math.floor((lat + halfLat - originY) / resY), 0, height);
const y1 = clamp(Math.ceil((lat - halfLat - originY) / resY), 0, height);

const [data] = await image.readRasters({ window: [x0, y0, x1, y1] });
const w = x1 - x0;
const h = y1 - y0;

let min = Infinity;
let max = -Infinity;
let maxIndex = 0;
for (let i = 0; i < data.length; i++) {
  const v = data[i];
  if (v < min) min = v;
  if (v > max) { max = v; maxIndex = i; }
}
const maxLon = originX + (x0 + (maxIndex % w) + 0.5) * resX;
const maxLat = originY + (y0 + Math.floor(maxIndex / w) + 0.5) * resY;

const overviews = [];
for (let i = 1; i < imageCount; i++) {
  const o = await tiff.getImage(i);
  overviews.push(`${o.getWidth()}x${o.getHeight()}`);
}

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
console.log(
  JSON.stringify(
    {
      url,
      platform: `${process.platform} node ${process.version}`,
      file: { bytes: fileBytes, megabytes: round(fileBytes / 1e6), pixels: `${width}x${height}`, metresPerPixel: round(Math.abs(resY) * kmPerDegLat * 1000), internalTile: `${image.getTileWidth()}x${image.getTileHeight()}`, sampleArray: data.constructor.name, compression: image.fileDirectory.Compression === 8 ? "deflate" : String(image.fileDirectory.Compression), overviews },
      window: { centre: [lon, lat], sizeKm, pixels: `${w}x${h}`, samples: data.length },
      elevation: { minMetres: round(min), maxMetres: round(max), maxAt: [round(maxLon, 4), round(maxLat, 4)] },
      network: {
        requests: net.requests,
        bytesHeader: headerBytes,
        bytesTotal: net.bytes,
        megabytesTotal: round(net.bytes / 1e6, 2),
        shareOfFile: `${round((net.bytes / fileBytes) * 100)}%`,
        rangeRequests: net.ranges.length,
        retries: net.retries,
      },
      seconds: round((performance.now() - started) / 1000, 2),
    },
    null,
    2,
  ),
);
