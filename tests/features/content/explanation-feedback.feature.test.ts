/**
 * Product definition:
 *   "Explain: the child types or chooses words to build a one- or two-sentence
 *    explanation. The AI compares it to a scoring rubric and either accepts it or gives one hint."
 *   "Below the threshold the child gets a multiple-choice follow-up instead."
 *   "The only step that needs the network during a mission is the AI check, and it has an offline fallback."
 *   Child safety: "No free conversation."
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { checkExplanationLocally, findExplainTask, validatePack, type ExplanationFeedback } from "@dunialab/content";
import { feature, scenario } from "../support/gherkin.js";
import { startApi } from "../support/api.js";

const require = createRequire(import.meta.url);
const pack = validatePack(JSON.parse(readFileSync(require.resolve("@dunialab/content/packs/kenya-explorer.json"), "utf8"))).pack!;
const mountainsWhy = findExplainTask(pack, "m4-t4-explain")!;

feature("A child's explanation gets accepted, one hint, or a multiple-choice follow-up (offline)", () => {
  scenario("a good explanation is accepted with no network", async ({ given, when, then }) => {
    let answer = "";
    let fb: ExplanationFeedback;
    await given("the phone is offline and Amani writes a sensible explanation", () => {
      answer = "Mount Kenya is very high so it is colder up there than at the coast";
    });
    await when("the app checks it on the device", () => {
      fb = checkExplanationLocally(mountainsWhy, answer, "en");
    });
    await then("it is accepted and marked as checked locally", () => {
      expect(fb.outcome).toBe("accepted");
      expect(fb.checkedBy).toBe("local");
    });
  });

  scenario("a partial explanation gets exactly one teacher-written hint", async ({ given, when, then, and }) => {
    let fb1: ExplanationFeedback;
    let fb2: ExplanationFeedback;
    const answer = "because it is a big mountain";
    await given("Amani's first explanation is missing the key idea", () => {});
    await when("the app checks her first and second attempts", () => {
      fb1 = checkExplanationLocally(mountainsWhy, answer, "en", 1);
      fb2 = checkExplanationLocally(mountainsWhy, answer, "en", 2);
    });
    await then("the first attempt gets a hint chosen from the approved list", () => {
      expect(fb1.outcome).toBe("hint");
      expect(mountainsWhy.hints.map((h) => h.id)).toContain(fb1.hintId);
    });
    await and("the second attempt moves to the multiple-choice follow-up, not a second hint", () => {
      expect(fb2.outcome).toBe("choice-follow-up");
    });
  });

  scenario("feedback can never contain free text from a model", async ({ then }) => {
    await then("the feedback object only carries an outcome and a hint id", () => {
      const fb = checkExplanationLocally(mountainsWhy, "it is cold because it is high", "en");
      expect(Object.keys(fb).sort()).toEqual(["checkedBy", "confidence", "criteriaMet", "flagForTeacher", "hintId", "outcome"]);
    });
  });
});

feature("Content cannot ship to children without teacher approval", () => {
  // Its own fixtures (findings register CR42): the shipped pack will be approved one day, and that
  // must change what children get, not break this test.
  scenario("a production API lists an approved pack and never a draft", async ({ given, when, then }) => {
    let dir = "";
    let ids: string[] = [];
    await given("a packs folder holding one approved and one draft pack", () => {
      dir = mkdtempSync(join(tmpdir(), "dunialab-approval-"));
      const base = JSON.parse(readFileSync(require.resolve("@dunialab/content/packs/kenya-explorer.json"), "utf8"));
      writeFileSync(join(dir, "approved.json"), JSON.stringify({ ...base, id: "zz.approved", review: { ...base.review, status: "approved", reviewedBy: "Teacher" } }));
      writeFileSync(join(dir, "draft.json"), JSON.stringify({ ...base, id: "zz.draft", review: { ...base.review, status: "draft" } }));
    });
    await when("an API that does not allow drafts lists its catalogue", async () => {
      const api = await startApi({ packsDir: dir, allowDraftContent: false });
      try {
        ids = (await api.call<{ id: string }[]>("GET", "/v1/catalog")).body.map((p) => p.id);
      } finally {
        await api.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
    await then("only the approved pack is offered", () => expect(ids).toEqual(["zz.approved"]));
  });
});
