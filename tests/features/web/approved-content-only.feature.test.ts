/**
 * Product definition: "Only review.status = approved packs ship to children in production."
 * Findings register S1: the API refused unapproved packs in production, but the web app bundled
 * every valid pack and only showed a "draft" banner, so a production web build put unreviewed
 * lessons in front of children.
 *
 * The rule now holds for the web app too. Draft content can still be shown in development, or in a
 * production build when someone explicitly allows it (for a pilot rehearsal), and the app says so.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { validatePack, type ContentPack } from "@dunialab/content";
import { selectPacks } from "../../../apps/web/src/lib/pack-selection.js";
import { feature, scenario } from "../support/gherkin.js";

const kenya = validatePack(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../../packages/content/packs/kenya-explorer.json", import.meta.url)), "utf8")),
).pack!;
const withStatus = (pack: ContentPack, id: string, status: ContentPack["review"]["status"]): ContentPack => ({
  ...pack,
  id,
  review: { ...pack.review, status },
});
const draft = withStatus(kenya, "zz.draft-pack", "draft");
const inReview = withStatus(kenya, "zz.in-review-pack", "teacher-review");
const approved = withStatus(kenya, "zz.approved-pack", "approved");

feature("Only teacher-approved lessons reach children in production", () => {
  scenario("a production build leaves out every pack that is not approved", async ({ given, when, then, and }) => {
    let result = selectPacks([], { production: false, allowDraft: false });
    await given("three packs: one draft, one in teacher review, one approved", () => {});
    await when("the web app is built for production", () => {
      result = selectPacks([draft, inReview, approved], { production: true, allowDraft: false });
    });
    await then("only the approved pack is offered to children", () => {
      expect(result.packs.map((p) => p.id)).toEqual(["zz.approved-pack"]);
    });
    await and("the app knows unapproved packs were held back, so it can say so honestly", () => {
      expect(result.withheld.sort()).toEqual(["zz.draft-pack", "zz.in-review-pack"]);
      expect(result.showingDrafts).toBe(false);
    });
  });

  scenario("positive control: approved content is never held back", async ({ when, then }) => {
    let result = selectPacks([], { production: true, allowDraft: false });
    await when("only approved packs exist", () => {
      result = selectPacks([approved], { production: true, allowDraft: false });
    });
    await then("all of them are offered and nothing is reported as withheld", () => {
      expect(result.packs.map((p) => p.id)).toEqual(["zz.approved-pack"]);
      expect(result.withheld).toEqual([]);
    });
  });

  scenario("draft content can be shown for development and rehearsals, and is labelled", async ({ when, then, and }) => {
    let dev = selectPacks([], { production: false, allowDraft: false });
    let rehearsal = selectPacks([], { production: true, allowDraft: false });
    await when("the app runs in development, or a production build explicitly allows drafts", () => {
      dev = selectPacks([draft, approved], { production: false, allowDraft: false });
      rehearsal = selectPacks([draft, approved], { production: true, allowDraft: true });
    });
    await then("the draft pack is included in both", () => {
      expect(dev.packs.map((p) => p.id)).toContain("zz.draft-pack");
      expect(rehearsal.packs.map((p) => p.id)).toContain("zz.draft-pack");
    });
    await and("the app knows it is showing unapproved content, so the draft banner appears", () => {
      expect(dev.showingDrafts).toBe(true);
      expect(rehearsal.showingDrafts).toBe(true);
    });
  });

  scenario("the real Kenya pack is offered in production exactly when a teacher has approved it (findings register CR44)", async ({ when, then }) => {
    let result = selectPacks([], { production: false, allowDraft: false });
    await when("the real Kenya Explorer pack goes through a production build", () => {
      result = selectPacks([kenya], { production: true, allowDraft: false });
    });
    await then("it is offered if approved and held back otherwise, so approving it changes the app, not the tests", () => {
      const approvedNow = kenya.review.status === "approved";
      expect(result.packs.map((p) => p.id)).toEqual(approvedNow ? [kenya.id] : []);
      expect(result.withheld).toEqual(approvedNow ? [] : [kenya.id]);
    });
  });
});
