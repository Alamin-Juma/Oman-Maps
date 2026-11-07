/**
 * Product definition:
 *   "Explain: the child types or chooses words to build a one- or two-sentence
 *    explanation. The AI compares it to a scoring rubric and either accepts it or gives one hint."
 *   "Below the threshold the child gets a multiple-choice follow-up instead."
 *   "The only step that needs the network during a mission is the AI check, and it has an offline fallback."
 *   Child safety: "No free conversation."
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect } from "vitest";
import { checkExplanationLocally, findExplainTask, validatePack, type ExplanationFeedback } from "@dunialab/content";
import { feature, scenario } from "../support/gherkin.js";

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
  scenario("the engineering draft of Kenya Explorer is not approved", async ({ then }) => {
    await then("its review status is not 'approved'", () => expect(pack.review.status).not.toBe("approved"));
  });
});
