import { describe, expect, it } from "vitest";
import { terrainRgbToMetres } from "@dunialab/content";
import {
  bakeShade,
  boxBlur,
  cellOf,
  cropGrid,
  decodeTerrainRgb,
  distanceToPolylineKm,
  encodeTerrainRgb,
  gridFromFunction,
  halve,
  haversineKm,
  hypsometricColour,
  LAND_COVER,
  latToTileY,
  lonToTileX,
  mipChain,
  pathLengthKm,
  pickLevel,
  sample,
  SEA_COLOUR,
  squareAround,
  surfaceColour,
  tileBounds,
  tileMetresPerPixel,
  tilesForBounds,
  tileXToLon,
  tileYToLat,
  toRaw16,
  zoomForTileCount,
  type Bounds,
} from "../src/index.js";

describe("distances", () => {
  it("measures one degree of latitude as about 111 km", () => {
    expect(haversineKm([37, 0], [37, 1])).toBeCloseTo(111.2, 0);
  });

  it("measures one degree of longitude as shorter away from the equator", () => {
    expect(haversineKm([0, 0], [1, 0])).toBeCloseTo(111.2, 0);
    expect(haversineKm([0, 60], [1, 60])).toBeCloseTo(55.6, 0);
  });

  it("adds up a path", () => {
    expect(pathLengthKm([[0, 0], [0, 1], [0, 2]])).toBeCloseTo(222.4, 0);
  });

  it("finds the distance to the nearest part of a line, including past its ends", () => {
    const line: [number, number][] = [[0, 0], [1, 0]];
    expect(distanceToPolylineKm([0.5, 0.1], line)).toBeCloseTo(11.06, 1);
    expect(distanceToPolylineKm([1.5, 0], line)).toBeCloseTo(55.66, 0);
    expect(distanceToPolylineKm([0.3, 0], line)).toBeCloseTo(0, 5);
  });

  it("makes a square of the requested size around a point", () => {
    const [[w, s], [e, n]] = squareAround([37, -3], 40);
    expect(haversineKm([w, -3], [e, -3])).toBeCloseTo(40, 0);
    expect(haversineKm([37, s], [37, n])).toBeCloseTo(40, 0);
  });
});

describe("Web Mercator tiles", () => {
  it("round-trips longitude and latitude through tile coordinates", () => {
    for (const [lon, lat] of [[37.3, -0.15], [-70.5, 42.1], [0, 0], [179, -80]] as const) {
      expect(tileXToLon(lonToTileX(lon, 9), 9)).toBeCloseTo(lon, 9);
      expect(tileYToLat(latToTileY(lat, 9), 9)).toBeCloseTo(lat, 9);
    }
  });

  it("puts the equator and the prime meridian on tile edges", () => {
    const [[west, south], [east, north]] = tileBounds(1, 1, 0);
    expect([west, south, east]).toEqual([0, 0, 180]);
    expect(north).toBeCloseTo(85.0511, 3);
  });

  it("lists the tiles covering a box, north-west first, without spilling over shared edges", () => {
    expect(tilesForBounds([[0, 0], [180, 85]], 1)).toEqual([{ x: 1, y: 0 }]);
    expect(tilesForBounds([[-10, -10], [10, 10]], 1)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
  });

  it("chooses the deepest zoom that still needs few tiles", () => {
    const box: Bounds = [[33.5, -5], [42, 5.5]];
    const z = zoomForTileCount(box, 9);
    expect(tilesForBounds(box, z).length).toBeLessThanOrEqual(9);
    expect(tilesForBounds(box, z + 1).length).toBeGreaterThan(9);
  });

  it("knows the ground size of a pixel", () => {
    expect(tileMetresPerPixel(0, 0, 256)).toBeCloseTo(156543, 0);
    expect(tileMetresPerPixel(8, 0, 512)).toBeCloseTo(305.7, 0);
    expect(tileMetresPerPixel(8, 60, 512)).toBeCloseTo(152.9, 0);
  });
});

describe("grids", () => {
  const ramp = gridFromFunction([[0, 0], [4, 2]], 0.5, (lon) => lon * 10);

  it("evaluates the function at cell centres", () => {
    expect([ramp.width, ramp.height]).toEqual([8, 4]);
    expect(ramp.data[0]).toBeCloseTo(2.5);
    expect(cellOf(ramp, [3.9, 0.1])).toEqual([7, 3]);
    expect(cellOf(ramp, [99, 99])).toEqual([7, 0]);
  });

  it("samples between cells and clamps outside", () => {
    expect(sample(ramp, 1, 1)).toBeCloseTo(10);
    expect(sample(ramp, 1.1, 1)).toBeCloseTo(11);
    expect(sample(ramp, -5, 1)).toBeCloseTo(2.5);
  });

  it("halves by averaging and keeps the array type", () => {
    const half = halve(ramp);
    expect([half.width, half.height, half.cell]).toEqual([4, 2, 1]);
    expect(half.data[0]).toBeCloseTo(5);
    const bytes = halve({ ...ramp, data: Uint8Array.from(ramp.data) });
    expect(bytes.data).toBeInstanceOf(Uint8Array);
  });

  it("picks the mip level that matches the wanted detail", () => {
    const big = gridFromFunction([[0, 0], [8, 8]], 1 / 32, (lon, lat) => lon + lat);
    const chain = mipChain(big, 8);
    expect(chain.length).toBeGreaterThan(3);
    expect(pickLevel(chain, 1 / 32).cell).toBeCloseTo(1 / 32);
    expect(pickLevel(chain, 1 / 9).cell).toBeCloseTo(1 / 16);
    expect(pickLevel(chain, 100).cell).toBe(chain.at(-1)!.cell);
    expect(pickLevel(chain, 1e-9).cell).toBeCloseTo(1 / 32);
  });

  it("keeps the last row and column when halving an odd-sized grid (findings register CR68)", () => {
    // 3 x 3 cells; the only land is in the last column.
    const odd = { width: 3, height: 3, west: 0, north: 3, cell: 1, data: Float32Array.from([0, 0, 90, 0, 0, 90, 0, 0, 90]) };
    const half = halve(odd);
    expect([half.width, half.height]).toEqual([2, 2]);
    expect(half.data[1]).toBeCloseTo(90); // the edge block averages only the cells that exist
    expect(half.data[3]).toBeCloseTo(90);
    expect(half.data[0]).toBeCloseTo(0);
  });

  it("refuses a crop that does not touch the grid (findings register CR69)", () => {
    const g = { width: 3, height: 3, west: 0, north: 3, cell: 1, data: new Float32Array(9) };
    expect(() => cropGrid(g, [[4, 0], [5, 3]])).toThrow(/not overlap the grid/);
    expect(() => cropGrid(g, [[0, 4], [3, 5]])).toThrow(/not overlap the grid/);
  });

  it("crops to whole cells and keeps positions", () => {
    const crop = cropGrid(ramp, [[1, 0.5], [2.6, 1.5]]);
    expect([crop.west, crop.north, crop.width, crop.height]).toEqual([1, 1.5, 4, 2]);
    expect(sample(crop, 2, 1)).toBeCloseTo(sample(ramp, 2, 1));
  });
});

describe("terrain-rgb", () => {
  it("round-trips heights to the chosen step, including below sea level and the summit of Everest", () => {
    const heights = [0, 1134.4, 5199, -430.5, 8848.86, 0.04];
    const back = decodeTerrainRgb(encodeTerrainRgb(heights, 1));
    heights.forEach((h, i) => expect(back[i]).toBeCloseTo(Math.round(h), 4));
    const fine = decodeTerrainRgb(encodeTerrainRgb(heights, 0.1));
    heights.forEach((h, i) => expect(fine[i]).toBeCloseTo(h, 1));
  });

  it("matches the published formula", () => {
    const [r, g, b] = encodeTerrainRgb([1234], 1);
    expect(terrainRgbToMetres(r!, g!, b!)).toBeCloseTo(1234, 4);
  });

  it("stores non-numbers as sea level instead of garbage", () => {
    expect(decodeTerrainRgb(encodeTerrainRgb([Number.NaN], 1))[0]).toBeCloseTo(0, 4);
  });
});

describe("baked relief light", () => {
  const plane = (size: number, margin: number, slope: (x: number, y: number) => number) => {
    const full = size + 2 * margin;
    const h = new Float32Array(full * full);
    for (let y = 0; y < full; y++) for (let x = 0; x < full; x++) h[y * full + x] = slope(x, y);
    return h;
  };
  const opts = { metresPerPixel: 100, zFactor: 1 };

  it("lights flat ground evenly", () => {
    const shade = bakeShade(plane(8, 2, () => 500), 8, 8, 2, opts);
    expect(new Set(shade).size).toBe(1);
    expect(shade[0]).toBeGreaterThan(200);
  });

  it("makes slopes facing the north-west sun brighter than slopes facing away", () => {
    // Height rising toward the south-east: the surface faces north-west, toward the light.
    const facing = bakeShade(plane(8, 2, (x, y) => (x + y) * 50), 8, 8, 2, opts);
    const away = bakeShade(plane(8, 2, (x, y) => -(x + y) * 50), 8, 8, 2, opts);
    expect(facing[20]!).toBeGreaterThan(away[20]! + 60);
  });

  it("darkens the bottom of a hollow", () => {
    const bowl = plane(16, 4, (x, y) => Math.hypot(x - 12, y - 12) * 40);
    const shade = bakeShade(bowl, 16, 16, 4, opts);
    const flat = bakeShade(plane(16, 4, () => 0), 16, 16, 4, opts);
    expect(shade[8 * 16 + 8]!).toBeLessThan(flat[8 * 16 + 8]!);
  });

  it("handles images that are not square, and rejects the wrong amount of data", () => {
    const full = new Float32Array((10 + 2) * (4 + 2));
    expect(bakeShade(full, 10, 4, 1, opts)).toHaveLength(40);
    expect(() => bakeShade(new Float32Array(10), 10, 4, 1, opts)).toThrow(/expected/);
  });

  it("blurs without changing a constant image", () => {
    const blurred = boxBlur(new Float32Array(6 * 4).fill(7), 6, 4, 2);
    for (const v of blurred) expect(v).toBeCloseTo(7, 5);
  });
});

describe("surface colour", () => {
  it("goes from green lowlands to pale summits by elevation", () => {
    const low = hypsometricColour(100);
    const high = hypsometricColour(5500);
    expect(low[1]).toBeGreaterThan(low[0]); // greener than red
    expect(Math.min(...high)).toBeGreaterThan(220); // nearly white
    expect(hypsometricColour(-50)).toEqual(hypsometricColour(0));
    expect(hypsometricColour(99999)).toEqual(hypsometricColour(5600));
  });

  it("shows sea, fresh water, forest and snow as what they are", () => {
    expect(surfaceColour(0, LAND_COVER.noData, true)).toEqual(SEA_COLOUR);
    const lake = surfaceColour(1134, LAND_COVER.water, false);
    expect(lake[2]).toBeGreaterThan(lake[0] + 60); // blue
    const forest = surfaceColour(2500, LAND_COVER.tree, false);
    const bare = surfaceColour(2500, LAND_COVER.bare, false);
    expect(forest[1]).toBeGreaterThan(forest[0]);
    expect(bare[0]).toBeGreaterThan(forest[0] + 60);
    expect(Math.min(...surfaceColour(5000, LAND_COVER.snow, false))).toBeGreaterThan(240);
  });

  it("falls back to elevation colour when land cover is unknown", () => {
    expect(surfaceColour(1500, 0, false)).toEqual(hypsometricColour(1500));
    expect(surfaceColour(1500, 255, false)).toEqual(hypsometricColour(1500));
  });
});

describe("Unity RAW export", () => {
  it("spreads the height range over 16 bits, little-endian", () => {
    const { bytes, minMetres, maxMetres } = toRaw16([100, 200, 300]);
    expect([minMetres, maxMetres]).toEqual([100, 300]);
    expect([...bytes]).toEqual([0, 0, 0x00, 0x80, 0xff, 0xff]);
  });

  it("does not divide by zero on flat terrain", () => {
    expect([...toRaw16([5, 5]).bytes]).toEqual([0, 0, 0, 0]);
  });
});
