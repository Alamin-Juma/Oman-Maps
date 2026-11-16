import { describe, expect, it } from "vitest";
import { BYTES_PER_MB, DELIVERY_BUDGET, deliveryBudgetViolations } from "../src/index.js";

describe("DELIVERY_BUDGET", () => {
  it("uses decimal megabytes", () => {
    expect(BYTES_PER_MB).toBe(1_000_000);
  });

  it("is internally consistent: a patch fits in a first open, which fits in a pack", () => {
    expect(DELIVERY_BUDGET.hdFeaturePatchBytes).toBeLessThan(DELIVERY_BUDGET.first3dOpenBytes);
    expect(DELIVERY_BUDGET.first3dOpenBytes).toBeLessThan(DELIVERY_BUDGET.pack3dTotalBytes);
    expect(DELIVERY_BUDGET.pack3dTotalBytes).toBeLessThan(DELIVERY_BUDGET.lfsStopAndAskBytes);
  });

  it("holds whole numbers of bytes", () => {
    for (const value of Object.values(DELIVERY_BUDGET)) expect(Number.isInteger(value)).toBe(true);
  });
});

describe("deliveryBudgetViolations", () => {
  it("reports nothing for an empty measurement", () => {
    expect(deliveryBudgetViolations({})).toEqual([]);
  });

  it("accepts a value exactly on the limit and rejects one byte more", () => {
    const limit = DELIVERY_BUDGET.first3dOpenBytes;
    expect(deliveryBudgetViolations({ first3dOpenBytes: limit })).toEqual([]);
    expect(deliveryBudgetViolations({ first3dOpenBytes: limit + 1 })).toHaveLength(1);
  });

  it("judges each HD patch on its own and names the offender", () => {
    const violations = deliveryBudgetViolations({
      hdFeaturePatchBytes: { ok: 1_000_000, big: 2_000_000, bigger: 3_000_000 },
    });
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain('"big"');
    expect(violations[1]).toContain('"bigger"');
  });

  it("reports every exceeded budget, in a stable order", () => {
    const violations = deliveryBudgetViolations({
      initialJsGzipBytes: 200_000,
      first3dOpenBytes: 4_000_000,
      hdFeaturePatchBytes: { p: 1_600_000 },
      pack3dTotalBytes: 30_000_000,
    });
    expect(violations.map((v) => v.split(":")[0])).toEqual([
      "first page load (JavaScript, gzip)",
      "first 3D open",
      'HD feature patch "p"',
      "all 3D assets of the pack",
    ]);
  });

  it("states the measured size and the limit in megabytes", () => {
    expect(deliveryBudgetViolations({ pack3dTotalBytes: 26_500_000 })).toEqual([
      "all 3D assets of the pack: 26.50 MB is over the 25.00 MB budget",
    ]);
  });

  it("treats a broken measurement as a violation, never as a pass", () => {
    expect(deliveryBudgetViolations({ first3dOpenBytes: Number.NaN })).toHaveLength(1);
    expect(deliveryBudgetViolations({ pack3dTotalBytes: -1 })).toHaveLength(1);
    expect(deliveryBudgetViolations({ initialJsGzipBytes: Number.POSITIVE_INFINITY })).toHaveLength(1);
  });
});
