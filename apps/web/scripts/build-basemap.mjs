#!/usr/bin/env node
// Cut the world atlas down to the countries inside the union of all packs' print bounds
// (plus a margin), so budget phones download KBs instead of the whole world.
// Run after adding a pack for a new region: npm run basemap -w @dunialab/web
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { feature } from "topojson-client";
import { overlapsBox } from "./basemap-filter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const world = JSON.parse(readFileSync(require.resolve("world-atlas/countries-50m.json"), "utf8"));
const packsDir = join(here, "..", "..", "..", "packages", "content", "packs");

const MARGIN = 6; // degrees
let [w, s, e, n] = [180, 90, -180, -90];
for (const f of readdirSync(packsDir).filter((f) => f.endsWith(".json"))) {
  const [[pw, ps], [pe, pn]] = JSON.parse(readFileSync(join(packsDir, f), "utf8")).printTarget.bounds;
  [w, s, e, n] = [Math.min(w, pw), Math.min(s, ps), Math.max(e, pe), Math.max(n, pn)];
}
[w, s, e, n] = [w - MARGIN, s - MARGIN, e + MARGIN, n + MARGIN];

const round = (x) => Math.round(x * 1000) / 1000;
const all = feature(world, world.objects.countries).features;
const kept = all
  .filter((f) => f.geometry && overlapsBox(f.geometry, [w, s, e, n]))
  .map((f) => ({
    type: "Feature",
    id: f.id,
    properties: { name: f.properties.name },
    geometry: {
      type: f.geometry.type,
      coordinates:
        f.geometry.type === "Polygon"
          ? f.geometry.coordinates.map((r) => r.map(([x, y]) => [round(x), round(y)]))
          : f.geometry.coordinates.map((p) => p.map((r) => r.map(([x, y]) => [round(x), round(y)]))),
    },
  }));

const out = join(here, "..", "src", "assets", "basemap.json");
writeFileSync(out, JSON.stringify({ type: "FeatureCollection", bbox: [w, s, e, n], features: kept }));
console.log(`basemap: ${kept.length} countries in [${w}, ${s}, ${e}, ${n}] -> ${out}`);
