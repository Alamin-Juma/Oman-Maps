import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { findExplainTask, validatePack } from "@dunialab/content";
import { decideFeedback } from "../src/explanations/decide.js";
import type { AiGrade } from "../src/explanations/ai-grader.js";

const require = createRequire(import.meta.url);
const pack = validatePack(JSON.parse(readFileSync(require.resolve("@dunialab/content/packs/kenya-explorer.json"), "utf8"))).pack!;
const task = findExplainTask(pack, "m4-t4-explain")!; // minCriteria 2; hints h-height, h-cool, h-coast

const grade = (g: Partial<AiGrade>): AiGrade => ({
  verdict: "meets",
  criteriaMet: ["height", "cooler"],
  hintId: null,
  confidence: 0.9,
  unsafe: false,
  ...g,
});

describe("decideFeedback", () => {
  it("accepts a confident meets with enough criteria", () => {
    expect(decideFeedback(task, grade({}), 1, 0.75)).toMatchObject({ outcome: "accepted", checkedBy: "ai" });
  });

  it("does not trust 'meets' when the model cites too few criteria", () => {
    expect(decideFeedback(task, grade({ criteriaMet: ["height"] }), 1, 0.75).outcome).toBe("hint");
  });

  it("drops invented criterion ids before counting", () => {
    const fb = decideFeedback(task, grade({ criteriaMet: ["height", "made-up", "made-up-2"] }), 1, 0.75);
    expect(fb.criteriaMet).toEqual(["height"]);
    expect(fb.outcome).toBe("hint");
  });

  it("counts a repeated criterion once", () => {
    expect(decideFeedback(task, grade({ criteriaMet: ["height", "height"] }), 1, 0.75).outcome).toBe("hint");
  });

  it("uses the model's hint only if it is approved and targets an unmet criterion", () => {
    expect(decideFeedback(task, grade({ verdict: "partial", criteriaMet: ["height"], hintId: "h-coast" }), 1, 0.75).hintId).toBe("h-coast");
    // h-height targets a criterion already met -> replaced
    expect(decideFeedback(task, grade({ verdict: "partial", criteriaMet: ["height"], hintId: "h-height" }), 1, 0.75).hintId).toBe("h-cool");
  });

  it("goes to the follow-up on the second attempt instead of a second hint", () => {
    expect(decideFeedback(task, grade({ verdict: "partial", criteriaMet: ["height"] }), 2, 0.75).outcome).toBe("choice-follow-up");
  });

  it("treats exactly-threshold confidence as confident, below as unsure", () => {
    expect(decideFeedback(task, grade({ confidence: 0.75 }), 1, 0.75).outcome).toBe("accepted");
    expect(decideFeedback(task, grade({ confidence: 0.7499 }), 1, 0.75).outcome).toBe("choice-follow-up");
  });

  it("clamps nonsense confidence values", () => {
    expect(decideFeedback(task, grade({ confidence: Number.NaN }), 1, 0.75).outcome).toBe("choice-follow-up");
    expect(decideFeedback(task, grade({ confidence: 7 }), 1, 0.75).confidence).toBe(1);
  });

  it("sends off-topic answers to the follow-up", () => {
    expect(decideFeedback(task, grade({ verdict: "off-topic", confidence: 0.99 }), 1, 0.75).outcome).toBe("choice-follow-up");
  });

  it("flags unsafe answers for a teacher even when they would otherwise pass", () => {
    expect(decideFeedback(task, grade({ unsafe: true }), 1, 0.75)).toMatchObject({ outcome: "choice-follow-up", flagForTeacher: true });
  });
});
