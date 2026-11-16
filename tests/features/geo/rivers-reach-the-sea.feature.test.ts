/**
 * Founder: "hitting Show river shows the 3D river flowing all the way from one point to the sea."
 * ADR-0009 section 3: we trace rivers ourselves on the elevation data, guided by a surveyed
 * line where one exists. No licensed river network, no hand drawing, no id-specific code.
 *
 * These scenarios pin the tracing rules on small made-up terrains with a known answer
 * (no network). The real Tana is checked in kenya-3d-assets.feature.test.ts.
 */
import { expect } from "vitest";
import { distanceToPolylineKm, gridFromFunction, haversineKm, traceRiver, type LonLat } from "../../../tools/geo/src/index.js";
import { feature, scenario } from "../support/gherkin.js";

/** A 2 x 1 degree land sloping east into the sea at 1.6 E, with a winding valley cut into it. */
const valleyLat = (lon: number) => 0.5 + 0.18 * Math.sin(lon * 5);
const COAST = 1.6;
const slopingLand = (lon: number, lat: number) => {
  if (lon >= COAST) return 0;
  const downToSea = (COAST - lon) * 600; // 600 m per degree
  const valleyWall = Math.min(400, Math.abs(lat - valleyLat(lon)) * 4000);
  return 5 + downToSea + valleyWall;
};
const BOUNDS: [LonLat, LonLat] = [[0, 0], [2, 1]];
const CELL = 1 / 240; // about 460 m

const roughPath: LonLat[] = [[0.2, valleyLat(0.2) + 0.03], [0.9, 0.5], [1.7, 0.5]];

feature("Rivers are traced on the elevation data, from the source to the sea", () => {
  scenario("water follows the valley downhill and reaches the sea", async ({ given, when, then, and }) => {
    const dem = gridFromFunction(BOUNDS, CELL, slopingLand);
    let river = traceRiver({ dem, roughPath, guides: [] });
    await given("a land that slopes to the sea with one winding valley, and a teacher's rough river line", () => {});
    await when("the river is traced", () => {
      river = traceRiver({ dem, roughPath, guides: [] });
    });
    await then("it starts close to where the teacher's line starts", () => {
      const first = river.points[0]!;
      expect(haversineKm([first[0], first[1]], roughPath[0]!)).toBeLessThan(10);
    });
    await and("it ends in the sea", () => {
      const last = river.points.at(-1)!;
      expect(river.endsIn).toBe("sea");
      expect(last[0]).toBeGreaterThan(COAST - 0.02);
      expect(last[2]).toBeLessThanOrEqual(5);
    });
    await and("water never flows uphill", () => {
      for (let i = 1; i < river.points.length; i++) {
        expect(river.points[i]![2]).toBeLessThanOrEqual(river.points[i - 1]![2]);
      }
    });
    await and("it stays in the valley, not on the hillsides", () => {
      for (const [lon, lat] of river.points) {
        if (lon < COAST - 0.05) expect(Math.abs(lat - valleyLat(lon))).toBeLessThan(0.03);
      }
    });
    await and("distance along the river only grows, and the river gets wider downstream", () => {
      for (let i = 1; i < river.points.length; i++) expect(river.points[i]![3]).toBeGreaterThan(river.points[i - 1]![3]);
      expect(river.points.at(-1)![4]).toBeGreaterThan(river.points[0]![4]);
      expect(river.lengthKm).toBeGreaterThan(150); // the straight line is ~155 km; the valley winds
    });
  });

  scenario("a hollow in the valley floor does not stop the river", async ({ given, when, then }) => {
    const withPit = (lon: number, lat: number) => {
      const base = slopingLand(lon, lat);
      const d = Math.hypot(lon - 0.9, lat - valleyLat(0.9));
      return d < 0.04 ? base - 120 * (1 - d / 0.04) : base; // a 120 m deep hollow
    };
    const dem = gridFromFunction(BOUNDS, CELL, withPit);
    let endsIn = "";
    await given("the same land with a deep hollow in the middle of the valley", () => {});
    await when("the river is traced", () => {
      endsIn = traceRiver({ dem, roughPath, guides: [] }).endsIn;
    });
    await then("it fills the hollow, spills over and still reaches the sea", () => expect(endsIn).toBe("sea"));
  });

  scenario("in flat land the river follows the surveyed guide line", async ({ given, when, then, and }) => {
    // A dead-flat plain 3 m above the sea: elevation alone cannot say where the river runs.
    const plain = (lon: number) => (lon >= COAST ? 0 : 3);
    const dem = gridFromFunction(BOUNDS, CELL, plain);
    const guide: LonLat[] = [[0.2, 0.2], [0.8, 0.75], [1.3, 0.3], [1.7, 0.6]];
    let river = traceRiver({ dem, roughPath: [[0.2, 0.2], [1.7, 0.6]], guides: [guide] });
    await given("a flat plain and a surveyed line that zig-zags across it", () => {});
    await when("the river is traced with the guide", () => {
      river = traceRiver({ dem, roughPath: [[0.2, 0.2], [1.7, 0.6]], guides: [guide] });
    });
    await then("the traced course stays close to the surveyed line", () => {
      for (const [lon, lat] of river.points) {
        if (lon < COAST - 0.03) expect(distanceToPolylineKm([lon, lat], guide)).toBeLessThan(4);
      }
    });
    await and("the result says it was guided and how far it strayed", () => {
      expect(river.guided).toBe(true);
      expect(river.maxOffGuideKm).not.toBeNull();
      expect(river.maxOffGuideKm!).toBeLessThan(6);
    });
  });

  scenario("a river whose line ends in a lake stops at the lake", async ({ given, when, then, and }) => {
    // A bowl: land slopes inward to a flat lake at 400 m. The sea is far away to the east.
    const bowl = (lon: number, lat: number) => {
      if (lon >= 1.95) return 0;
      const d = Math.hypot(lon - 1.0, lat - 0.5);
      return d < 0.15 ? 400 : 400 + (d - 0.15) * 3000;
    };
    const dem = gridFromFunction(BOUNDS, CELL, bowl);
    const path: LonLat[] = [[0.3, 0.5], [0.7, 0.5], [1.0, 0.5]];
    let river = traceRiver({ dem, roughPath: path, guides: [] });
    await given("a lake in a basin, and a teacher's river line that ends inside the lake", () => {});
    await when("the river is traced", () => {
      river = traceRiver({ dem, roughPath: path, guides: [] });
    });
    await then("it ends at the lake shore, not at the sea", () => {
      expect(river.endsIn).toBe("lake");
      const last = river.points.at(-1)!;
      expect(last[2]).toBeCloseTo(400, 0);
      expect(Math.hypot(last[0] - 1.0, last[1] - 0.5)).toBeLessThan(0.17);
    });
    await and("it does not cross the lake", () => {
      const inLake = river.points.filter(([lon, lat]) => Math.hypot(lon - 1.0, lat - 0.5) < 0.13);
      expect(inLake.length).toBeLessThanOrEqual(2);
    });
  });

  scenario("a river line with nowhere to drain is refused with a clear message", async ({ given, when, then }) => {
    const island = () => 50; // no sea anywhere in the data
    const dem = gridFromFunction(BOUNDS, CELL, island);
    let message = "";
    await given("elevation data with no sea and no lake under the line's end", () => {});
    await when("the river is traced", () => {
      try {
        traceRiver({ dem, roughPath, guides: [] });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
    });
    await then("the generator stops and says what is wrong, instead of drawing a made-up river", () => {
      expect(message).toMatch(/no sea or lake/i);
    });
  });
});
