/**
 * Product definition: budget Android phones on paid mobile data; offline after one download.
 * Brief docs/briefs/3d-explorer.md §3.6 turns that into numbers for the 3D Explorer:
 *   - the web app's first load must not grow (3D code is a lazy chunk);
 *   - opening 3D for the first time costs at most 3 MB;
 *   - one HD feature patch is at most 1.5 MB;
 *   - all 3D assets of one content pack total at most 25 MB.
 *
 * This feature writes those promises down ONCE, in a place every test and tool imports,
 * and gives one checker that says what is over budget in plain words.
 * Megabytes are decimal (1 MB = 1,000,000 bytes), the unit mobile data bundles are sold in.
 */
import { expect } from "vitest";
import { DELIVERY_BUDGET, deliveryBudgetViolations } from "@dunialab/content";
import { feature, scenario } from "../support/gherkin.js";

feature("3D Explorer stays inside a Kenyan family's data budget", () => {
  scenario("the budgets are written down as the numbers the founder agreed", async ({ given, then, and }) => {
    await given("the 3D Explorer brief, section 3.6", () => {});
    await then("opening 3D for the first time may cost at most 3 MB", () => {
      expect(DELIVERY_BUDGET.first3dOpenBytes).toBe(3_000_000);
    });
    await and("one HD feature patch may cost at most 1.5 MB", () => {
      expect(DELIVERY_BUDGET.hdFeaturePatchBytes).toBe(1_500_000);
    });
    await and("all 3D assets of one pack may total at most 25 MB", () => {
      expect(DELIVERY_BUDGET.pack3dTotalBytes).toBe(25_000_000);
    });
    await and("the first page load keeps its pre-3D size, with a small tolerance", () => {
      // Measured before any 3D work: 145.7 kB gzip. The limit is 150 kB; 3D must be a lazy chunk.
      expect(DELIVERY_BUDGET.initialJsGzipBytes).toBe(150_000);
    });
  });

  scenario("assets inside every budget are accepted", async ({ given, when, then }) => {
    let violations: string[] = ["not checked"];
    await given("a pack whose 3D assets were measured after generation", () => {});
    await when("the measurements are all inside the budgets", () => {
      violations = deliveryBudgetViolations({
        initialJsGzipBytes: 146_000,
        first3dOpenBytes: 2_400_000,
        hdFeaturePatchBytes: { "patch-a": 900_000, "patch-b": 1_500_000 },
        pack3dTotalBytes: 18_000_000,
      });
    });
    await then("nothing is reported", () => expect(violations).toEqual([]));
  });

  scenario("a pack that is too heavy for mobile data is rejected, naming what is over", async ({ given, when, then, and }) => {
    let violations: string[] = [];
    await given("a generated pack with one oversized HD patch and a total over the limit", () => {});
    await when("the measurements are checked", () => {
      violations = deliveryBudgetViolations({
        hdFeaturePatchBytes: { "patch-a": 900_000, "patch-big": 1_700_000 },
        pack3dTotalBytes: 26_500_000,
      });
    });
    await then("both problems are reported, and the patch inside its budget is not", () => {
      expect(violations).toHaveLength(2);
      expect(violations.join("\n")).toContain("patch-big");
      expect(violations.join("\n")).not.toContain("patch-a");
    });
    await and("each message shows the measured size and the limit, so the fix is obvious", () => {
      expect(violations.join("\n")).toMatch(/1\.70 MB.*1\.50 MB/);
      expect(violations.join("\n")).toMatch(/26\.50 MB.*25\.00 MB/);
    });
  });

  scenario("only what was measured is judged", async ({ given, when, then }) => {
    let violations: string[] = ["not checked"];
    await given("a tool that measured nothing but the first page load", () => {});
    await when("that single measurement is over its limit", () => {
      violations = deliveryBudgetViolations({ initialJsGzipBytes: 151_000 });
    });
    await then("exactly one problem is reported", () => expect(violations).toHaveLength(1));
  });
});
