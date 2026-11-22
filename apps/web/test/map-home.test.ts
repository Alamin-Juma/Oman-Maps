import { describe, expect, it } from "vitest";
import { isHomeBoundary } from "../src/lib/map-home.js";

const pack = (countryIsoNumeric?: string) => ({ ...(countryIsoNumeric ? { countryIsoNumeric } : {}) });

describe("isHomeBoundary (findings register P9, CR36)", () => {
  it("matches the pack's own boundary code, as a string or a number", () => {
    expect(isHomeBoundary("646", pack("646"))).toBe(true);
    expect(isHomeBoundary(646, pack("646"))).toBe(true);
  });

  it("matches nothing else", () => {
    expect(isHomeBoundary("404", pack("646"))).toBe(false);
    expect(isHomeBoundary(undefined, pack("646"))).toBe(false);
  });

  it("highlights nothing when the pack names no boundary", () => {
    expect(isHomeBoundary("404", pack())).toBe(false);
  });
  it("matches a number that lost its leading zero (findings register CR93)", () => {
    expect(isHomeBoundary(40, pack("040"))).toBe(true); // Austria in the atlas is 040
    expect(isHomeBoundary("040", pack("040"))).toBe(true);
    expect(isHomeBoundary(4, pack("004"))).toBe(true);
    expect(isHomeBoundary(40, pack("400"))).toBe(false);
  });
});
