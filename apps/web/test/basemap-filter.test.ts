import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain .mjs build script without type declarations
import { overlapsBox } from "../scripts/basemap-filter.mjs";

const square = (w: number, s: number, e: number, n: number) => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
const box: [number, number, number, number] = [10, 10, 20, 20];

describe("overlapsBox (findings register CR37)", () => {
  it("keeps a country that contains the whole map area", () => expect(overlapsBox(square(0, 0, 30, 30), box)).toBe(true));
  it("keeps a country whose edge crosses the box with no corner inside", () => expect(overlapsBox(square(12, 0, 18, 30), box)).toBe(true));
  it("positive control: keeps a country inside the box", () => expect(overlapsBox(square(12, 12, 18, 18), box)).toBe(true));
  it("drops a country far away", () => expect(overlapsBox(square(40, 40, 50, 50), box)).toBe(false));
  it("judges each part of a country separately (an overseas island far away does not pull it in)", () => {
    const farParts = { type: "MultiPolygon", coordinates: [square(40, 40, 50, 50).coordinates, square(-60, -20, -50, -10).coordinates] };
    expect(overlapsBox(farParts, box)).toBe(false);
    const onePartInside = { type: "MultiPolygon", coordinates: [square(40, 40, 50, 50).coordinates, square(0, 0, 30, 30).coordinates] };
    expect(overlapsBox(onePartInside, box)).toBe(true);
  });
  it("ignores a part that crosses the date line", () => expect(overlapsBox(square(-179, 10, 179, 20), box)).toBe(false));
});

