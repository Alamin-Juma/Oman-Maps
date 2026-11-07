import { describe, expect, it } from "vitest";
import { createMapProjection } from "../src/lib/projection.js";

const KENYA_BOUNDS: [[number, number], [number, number]] = [[33.5, -5.0], [42.0, 5.5]];
const extent: [[number, number], [number, number]] = [[24, 64], [616, 660]];

describe("createMapProjection", () => {
  const { project } = createMapProjection(KENYA_BOUNDS, extent);

  it("fills the drawing area with the pack's print bounds (not the whole globe)", () => {
    const [x1, y1] = project([33.5, 5.5]);
    const [x2, y2] = project([42.0, -5.0]);
    const width = x2 - x1;
    const height = y2 - y1;
    // One dimension must span (almost) the full extent.
    expect(Math.max(width / (616 - 24), height / (660 - 64))).toBeGreaterThan(0.98);
  });

  it("puts north up and east right", () => {
    const nairobi = project([36.817, -1.286]);
    const mtKenya = project([37.308, -0.152]);
    const mombasa = project([39.668, -4.043]);
    expect(mtKenya[1]).toBeLessThan(nairobi[1]); // north = up
    expect(mombasa[0]).toBeGreaterThan(nairobi[0]); // east = right
  });

  it("separates nearby features enough to tap them (Mount Elgon vs Kisumu, ~125 km)", () => {
    const [ex, ey] = project([34.55, 1.13]);
    const [kx, ky] = project([34.768, -0.092]);
    expect(Math.hypot(ex - kx, ey - ky)).toBeGreaterThan(44); // > one 44px touch target
  });

  it("reports a scale bar that matches the projection (200 km)", () => {
    const { scaleBar } = createMapProjection(KENYA_BOUNDS, extent);
    expect(scaleBar.km).toBe(200);
    // 200 km is about 1.8 degrees of longitude at the equator; at ~70 px/degree that is roughly 100+ px.
    expect(scaleBar.px).toBeGreaterThan(60);
    expect(scaleBar.px).toBeLessThan(300);
  });
});
