import { describe, expect, it } from "vitest";
import {
  bridgeGuides,
  carveChannel,
  detectLake,
  findFlatRegion,
  gridFromFunction,
  MinHeap,
  sample,
  simplifyLine,
  smoothLine,
  traceOutline,
  traceRiver,
  type Bounds,
  type LonLat,
  type RiverPoint,
} from "../src/index.js";

const BOX: Bounds = [[0, 0], [1, 1]];
const CELL = 1 / 120;

describe("MinHeap", () => {
  it("returns ids in key order, with duplicates, and grows past its first size", () => {
    const heap = new MinHeap();
    const keys = Array.from({ length: 3000 }, (_, i) => (i * 7919) % 1000);
    keys.forEach((k, i) => heap.push(k, i));
    let last = -Infinity;
    let count = 0;
    while (heap.size > 0) {
      const key = heap.topKey;
      const id = heap.pop();
      expect(key).toBeGreaterThanOrEqual(last);
      expect(keys[id]).toBe(key);
      last = key;
      count++;
    }
    expect(count).toBe(3000);
  });
});

describe("traceRiver", () => {
  // A plane tilted to the east; the sea begins at 0.9 E.
  const tilted = gridFromFunction(BOX, CELL, (lon) => (lon >= 0.9 ? 0 : (0.9 - lon) * 1000 + 2));

  it("needs at least two points", () => {
    expect(() => traceRiver({ dem: tilted, roughPath: [[0.1, 0.5]], guides: [] })).toThrow(/two points/);
  });

  it("drains a tilted plane straight to the sea", () => {
    const river = traceRiver({ dem: tilted, roughPath: [[0.1, 0.5], [0.95, 0.5]], guides: [] });
    expect(river.endsIn).toBe("sea");
    expect(river.guided).toBe(false);
    expect(river.maxOffGuideKm).toBeNull();
    expect(river.lengthKm).toBeGreaterThan(70);
    expect(river.lengthKm).toBeLessThan(105);
    expect(river.points.at(-1)![2]).toBe(0);
  });

  it("reports rounded, compact points", () => {
    const river = traceRiver({ dem: tilted, roughPath: [[0.1, 0.5], [0.95, 0.5]], guides: [] });
    for (const [lon, lat, elevation, km, width] of river.points) {
      expect(lon).toBe(Math.round(lon * 1e5) / 1e5);
      expect(lat).toBe(Math.round(lat * 1e5) / 1e5);
      expect(elevation).toBe(Math.round(elevation * 10) / 10);
      expect(km).toBe(Math.round(km * 100) / 100);
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(1);
    }
    // A straight river needs few points.
    expect(river.points.length).toBeLessThan(40);
  });

  it("keeps the river inside the corridor around a guide, even when a lower way to the sea exists elsewhere", () => {
    // Two valleys run east: a deep one in the south, a shallow one in the north. The guide follows the north one.
    const dem = gridFromFunction(BOX, CELL, (lon, lat) => {
      if (lon >= 0.9) return 0;
      const base = (0.9 - lon) * 500 + 300;
      const north = Math.abs(lat - 0.8) < 0.03 ? -100 : 0;
      const south = Math.abs(lat - 0.2) < 0.03 ? -290 : 0;
      return base + north + south;
    });
    const guide: LonLat[] = [[0.1, 0.8], [0.95, 0.8]];
    const river = traceRiver({ dem, roughPath: guide, guides: [guide], options: { guidedCorridorKm: 15 } });
    for (const [, lat] of river.points) expect(lat).toBeGreaterThan(0.6);
    expect(river.maxOffGuideKm!).toBeLessThan(5);
  });

  it("ignores guides that are too short to be lines", () => {
    const river = traceRiver({ dem: tilted, roughPath: [[0.1, 0.5], [0.95, 0.5]], guides: [[[0.5, 0.5]]] });
    expect(river.guided).toBe(false);
  });

  it("says so when the start cannot reach the outlet", () => {
    // A wall of sea-level cells does not exist here: the corridor around the line simply holds no sea.
    const inland = gridFromFunction(BOX, CELL, (lon, lat) => 100 + lon * 50 + lat * 20);
    expect(() => traceRiver({ dem: inland, roughPath: [[0.2, 0.5], [0.8, 0.5]], guides: [] })).toThrow(/no sea or lake/);
  });
});

describe("bridgeGuides", () => {
  const west: LonLat[] = [[0, 0], [0.4, 0]];
  const east: LonLat[] = [[0.9, 0], [1.5, 0]];

  it("joins two pieces of a surveyed river across a gap, closest ends first", () => {
    const joined = bridgeGuides([west, east], 120);
    expect(joined).toHaveLength(3);
    expect(joined[2]).toEqual([[0.4, 0], [0.9, 0]]);
  });

  it("leaves a gap open when it is longer than allowed", () => {
    expect(bridgeGuides([west, east], 20)).toHaveLength(2);
  });

  it("adds nothing when the pieces already touch, or there is only one", () => {
    expect(bridgeGuides([west, [[0.4, 0], [0.9, 0.2]]], 120)).toHaveLength(2);
    expect(bridgeGuides([west], 120)).toEqual([west]);
    expect(bridgeGuides([], 120)).toEqual([]);
  });

  it("connects three pieces with two bridges, never a loop", () => {
    const far: LonLat[] = [[2.0, 0], [2.5, 0]];
    expect(bridgeGuides([west, east, far], 120)).toHaveLength(5);
  });

  it("lets a river be traced along a guide that is drawn in two pieces", () => {
    const dem = gridFromFunction([[0, 0], [2, 1]], 1 / 120, (lon, lat) => (lon >= 1.8 ? 0 : (1.8 - lon) * 400 + 2 + Math.abs(lat - 0.5) * 300));
    const pieces: LonLat[][] = [[[0.1, 0.5], [0.5, 0.5]], [[1.1, 0.5], [1.85, 0.5]]];
    const river = traceRiver({ dem, roughPath: [[0.1, 0.5], [1.85, 0.5]], guides: pieces, options: { guidedCorridorKm: 10 } });
    expect(river.endsIn).toBe("sea");
    expect(river.guided).toBe(true);
    // Without the bridge the 66 km gap would cut the 10 km corridor in two.
    expect(() => traceRiver({ dem, roughPath: [[0.1, 0.5], [1.85, 0.5]], guides: pieces, options: { guidedCorridorKm: 10, maxGuideGapKm: 5 } })).toThrow(/no sea or lake|does not drain/);
  });
});

describe("carveChannel", () => {
  it("lowers terrain to the water level along the river and nowhere else", () => {
    const dem = gridFromFunction(BOX, CELL, () => 100);
    const river: RiverPoint[] = [[0.2, 0.5, 90, 0, 0.5], [0.8, 0.5, 60, 66, 1]];
    carveChannel(dem, river, 1);
    expect(sample(dem, 0.2, 0.5)).toBeLessThanOrEqual(90.5);
    expect(sample(dem, 0.8, 0.5)).toBeLessThanOrEqual(61);
    // Half-way along, the water is half-way between 90 and 60 (the channel is a cell or two wide).
    expect(Math.abs(sample(dem, 0.5, 0.5) - 75)).toBeLessThan(1.5);
    expect(sample(dem, 0.5, 0.8)).toBe(100);
  });

  it("never raises terrain that is already below the water", () => {
    const dem = gridFromFunction(BOX, CELL, () => 10);
    carveChannel(dem, [[0.2, 0.5, 90, 0, 0.5], [0.8, 0.5, 60, 66, 1]]);
    expect(sample(dem, 0.5, 0.5)).toBe(10);
  });

  it("skips the parts of a river that lie outside this piece of terrain", () => {
    const dem = gridFromFunction(BOX, CELL, () => 100);
    carveChannel(dem, [[5, 5, 1, 0, 0.5], [6, 6, 0, 150, 1]]);
    expect(Math.min(...dem.data)).toBe(100);
  });
});

describe("lakes", () => {
  const lakeAt: LonLat = [0.5, 0.5];
  const withLake = gridFromFunction(BOX, CELL, (lon, lat) => {
    const d = Math.hypot(lon - 0.5, lat - 0.5);
    return d < 0.1 ? 250 : 250 + (d - 0.1) * 2000;
  });

  it("finds the flat region under a point", () => {
    const region = findFlatRegion(withLake, lakeAt, 0)!;
    expect(region.levelMetres).toBe(250);
    expect(region.touchesEdge).toBe(false);
    // A circle of radius 0.1 degrees on a 1/120 grid: about pi * 12^2 cells.
    expect(region.cells).toBeGreaterThan(400);
    expect(region.cells).toBeLessThan(500);
  });

  it("finds a lake near the point when the point itself is on the shore", () => {
    expect(findFlatRegion(withLake, [0.5, 0.62], 0)).toBeNull();
    expect(findFlatRegion(withLake, [0.5, 0.62], 5)!.levelMetres).toBe(250);
  });

  it("never calls the sea a lake", () => {
    const sea = gridFromFunction(BOX, CELL, (lon) => (lon > 0.5 ? 0 : 40 + lon));
    expect(findFlatRegion(sea, [0.8, 0.5], 2)).toBeNull();
  });

  it("joins parts of one lake whose level steps slightly, as between source files", () => {
    const stepped = gridFromFunction(BOX, CELL, (lon, lat) => {
      const d = Math.hypot(lon - 0.5, lat - 0.5);
      if (d >= 0.1) return 250 + (d - 0.1) * 2000 + 5;
      return lon < 0.5 ? 250 : 250.6;
    });
    const region = findFlatRegion(stepped, [0.45, 0.5], 0)!;
    expect(region.cells).toBeGreaterThan(400);
  });

  it("reports level, area and a closed outline", () => {
    const lake = detectLake(withLake, lakeAt)!;
    expect(lake.surfaceMetres).toBe(250);
    // pi * (0.1 deg)^2 at the equator-ish latitude 0.5: about 386 km2
    expect(lake.areaKm2).toBeGreaterThan(340);
    expect(lake.areaKm2).toBeLessThan(430);
    expect(lake.outline[0]).toEqual(lake.outline.at(-1));
    expect(lake.outline.length).toBeGreaterThan(8);
    for (const [lon, lat] of lake.outline) expect(Math.hypot(lon - 0.5, lat - 0.5)).toBeCloseTo(0.1, 1);
    expect(lake.clippedByMap).toBe(false);
  });

  it("marks a lake that runs off the edge of the data", () => {
    const edge = gridFromFunction(BOX, CELL, (lon) => (lon < 0.3 ? 400 : 400 + (lon - 0.3) * 900));
    expect(detectLake(edge, [0.1, 0.5])!.clippedByMap).toBe(true);
  });

  it("returns nothing where there is no water, or only a puddle", () => {
    const slope = gridFromFunction(BOX, CELL, (lon, lat) => 10 + lon * 300 + lat * 100);
    expect(detectLake(slope, [0.5, 0.5])).toBeNull();
    expect(detectLake(withLake, lakeAt, 10, 5000)).toBeNull();
  });
});

describe("outlines and line clean-up", () => {
  it("traces the outer edge of a block and ignores a hole", () => {
    // 5 x 5 block with the middle cell missing, inside a 7 x 7 mask.
    const mask = new Uint8Array(49);
    for (let j = 1; j <= 5; j++) for (let i = 1; i <= 5; i++) mask[j * 7 + i] = 1;
    mask[3 * 7 + 3] = 0;
    const ring = traceOutline(mask, 7, 7);
    expect(ring).toHaveLength(20); // perimeter of a 5 x 5 square, in unit steps
    for (const [x, y] of ring) expect(x === 1 || x === 6 || y === 1 || y === 6).toBe(true);
  });

  it("traces a diagonal neighbour as part of the picture without getting lost", () => {
    const mask = Uint8Array.from([1, 0, 0, 1]); // two cells touching at a corner
    expect(traceOutline(mask, 2, 2).length).toBeGreaterThanOrEqual(4);
  });

  it("returns an empty outline for an empty mask", () => {
    expect(traceOutline(new Uint8Array(9), 3, 3)).toEqual([]);
  });

  it("drops points that add nothing and keeps corners", () => {
    const line = [[0, 0], [1, 0.001], [2, 0], [2, 1], [2, 2]] as const;
    expect(simplifyLine(line, 0.01)).toEqual([[0, 0], [2, 0], [2, 2]]);
    expect(simplifyLine(line.slice(0, 2), 0.01)).toHaveLength(2);
  });

  it("smooths a staircase but leaves both ends in place", () => {
    const stairs: LonLat[] = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]];
    const smooth = smoothLine(stairs, 1);
    expect(smooth[0]).toEqual([0, 0]);
    expect(smooth.at(-1)).toEqual([2, 2]);
    expect(smooth[1]![1]).toBeCloseTo(1 / 3);
  });
});
