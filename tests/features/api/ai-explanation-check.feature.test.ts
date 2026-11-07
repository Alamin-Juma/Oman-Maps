/**
 * Product definition:
 *   "AI service: a hosted large language model behind our own API, given only the approved
 *    rubric and the mission. Output limited to one of a fixed set of feedback types."
 *   "Fixed rules decide mastery. The AI result is one input, with a confidence threshold.
 *    Below the threshold the child gets a multiple-choice follow-up instead."
 *   "The only step that needs the network during a mission is the AI check, and it has an offline fallback."
 */
import { afterEach, expect } from "vitest";
import type { AiGrade, AiGrader } from "@dunialab/api";
import { feature, scenario } from "../support/gherkin.js";
import { parentToken, startApi, type TestApi } from "../support/api.js";

let api: TestApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

/** Scripted grader: returns a fixed grade and records what it was sent. */
function scripted(grade: AiGrade | Error) {
  const calls: Parameters<AiGrader["grade"]>[0][] = [];
  const grader: AiGrader = {
    grade: async (input) => {
      calls.push(input);
      if (grade instanceof Error) throw grade;
      return grade;
    },
  };
  return { grader, calls };
}

const check = (t: string, answer: string, attempt = 1) =>
  api!.call("POST", "/v1/explanations/check", { packId: "ke.g5.sst.kenya-explorer", taskId: "m4-t4-explain", answer, locale: "en", attempt }, t);

feature("The AI checks explanations but only ever returns a fixed feedback type", () => {
  scenario("a confident AI 'meets rubric' is accepted", async ({ given, when, then }) => {
    let res: any;
    const { grader } = scripted({ verdict: "meets", criteriaMet: ["height", "cooler"], hintId: null, confidence: 0.92, unsafe: false });
    await given("the AI is confident the explanation meets the rubric", async () => {
      api = await startApi({ aiGrader: grader });
    });
    await when("the app checks the explanation", async () => {
      res = await check(await parentToken(api!), "the top is high up so the air is colder");
    });
    await then("the child sees 'accepted', checked by AI", () => {
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ outcome: "accepted", checkedBy: "ai", hintId: null });
    });
  });

  scenario("an unsure AI never decides: the child gets the multiple-choice follow-up", async ({ given, when, then }) => {
    let res: any;
    const { grader } = scripted({ verdict: "meets", criteriaMet: ["height"], hintId: null, confidence: 0.4, unsafe: false });
    await given("the AI's confidence is below the threshold", async () => {
      api = await startApi({ aiGrader: grader });
    });
    await when("the app checks the explanation", async () => {
      res = await check(await parentToken(api!), "its high");
    });
    await then("the outcome is the multiple-choice follow-up", () => expect(res.body.outcome).toBe("choice-follow-up"));
  });

  scenario("the AI can only pick a hint that a teacher wrote for this task", async ({ given, when, then }) => {
    let res: any;
    const { grader } = scripted({ verdict: "partial", criteriaMet: ["height"], hintId: "h-invented-by-model", confidence: 0.9, unsafe: false });
    await given("the AI returns a hint id that is not in the approved list", async () => {
      api = await startApi({ aiGrader: grader });
    });
    await when("the app checks the explanation", async () => {
      res = await check(await parentToken(api!), "because it is high");
    });
    await then("the server substitutes the approved hint for the first missing criterion", () => {
      expect(res.body.outcome).toBe("hint");
      expect(res.body.hintId).toBe("h-cool");
    });
  });

  scenario("unsafe content is never 'accepted' and is flagged for a teacher", async ({ given, when, then }) => {
    let res: any;
    const { grader } = scripted({ verdict: "meets", criteriaMet: ["height", "cooler"], hintId: null, confidence: 0.99, unsafe: true });
    await given("the AI marks the answer as unsafe", async () => {
      api = await startApi({ aiGrader: grader });
    });
    await when("the app checks the explanation", async () => {
      res = await check(await parentToken(api!), "high and cold ...");
    });
    await then("the child gets the follow-up and a teacher flag is raised", () => {
      expect(res.body.outcome).toBe("choice-follow-up");
      expect(res.body.flagForTeacher).toBe(true);
    });
  });

  scenario("when the AI is down, the offline rubric checker answers instead", async ({ given, when, then }) => {
    let res: any;
    const { grader } = scripted(new Error("network unreachable"));
    await given("the AI service is failing", async () => {
      api = await startApi({ aiGrader: grader });
    });
    await when("the app checks a good explanation", async () => {
      res = await check(await parentToken(api!), "Mount Kenya is very high so it is colder than the coast");
    });
    await then("it is accepted by the local checker, not an error", () => {
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ outcome: "accepted", checkedBy: "local" });
    });
  });

  scenario("the AI is never sent anything that identifies the child", async ({ given, when, then }) => {
    const { grader, calls } = scripted({ verdict: "meets", criteriaMet: ["height", "cooler"], hintId: null, confidence: 0.9, unsafe: false });
    await given("an AI grader that records its input", async () => {
      api = await startApi({ aiGrader: grader });
    });
    await when("a parent's child submits an explanation", async () => {
      await check(await parentToken(api!), "high so colder");
    });
    await then("the grader received only the task, the rubric, the locale and the answer", () => {
      expect(Object.keys(calls[0]!).sort()).toEqual(["answer", "locale", "task"]);
    });
  });
});
