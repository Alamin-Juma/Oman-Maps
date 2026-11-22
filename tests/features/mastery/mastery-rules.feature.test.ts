/**
 * Product definition, "Engineering decisions that protect the product":
 *   "Fixed rules decide mastery. The AI result is one input."
 *   "Mastered = correct on two separate days, including one explanation."
 *   "Short spaced-review questions come back over the following days and weeks,
 *    mixing topics so the child does not just repeat the last thing studied."
 */
import { expect } from "vitest";
import { buildReviewQueue, computeSkillStates, weeklySummary, type AttemptEvent } from "@dunialab/mastery";
import { feature, scenario } from "../support/gherkin.js";

const at = (day: string, hour = 9) => `${day}T${String(hour - 3).padStart(2, "0")}:00:00Z`; // EAT hour -> UTC
let n = 0;
const attempt = (skillId: string, day: string, opts: Partial<AttemptEvent> = {}): AttemptEvent => ({
  eventId: `ev-${++n}`,
  profileId: "amani",
  skillId,
  taskId: "t",
  kind: "choice",
  correct: true,
  occurredAt: at(day),
  context: "mission",
  ...opts,
});

feature("Mastery is decided by fixed rules, never by the AI", () => {
  scenario("one good day is not mastery", async ({ given, when, then }) => {
    let events: AttemptEvent[] = [];
    let status = "";
    await given("Amani answered correctly AND explained well, all on Monday", () => {
      events = [attempt("features.mountains", "2027-01-11"), attempt("features.mountains", "2027-01-11", { kind: "explain" })];
    });
    await when("we compute her skill state", () => {
      status = computeSkillStates(events)["features.mountains"]!.status;
    });
    await then("the skill is Practising, not Mastered", () => expect(status).toBe("practising"));
  });

  scenario("correct on two separate days, including an explanation, is mastery", async ({ given, when, then }) => {
    let events: AttemptEvent[] = [];
    let state: ReturnType<typeof computeSkillStates>[string];
    await given("Amani answered correctly on Monday and explained correctly on Tuesday", () => {
      events = [attempt("features.mountains", "2027-01-11"), attempt("features.mountains", "2027-01-12", { kind: "explain", checkedBy: "ai" })];
    });
    await when("we compute her skill state", () => {
      state = computeSkillStates(events)["features.mountains"]!;
    });
    await then("the skill is Mastered, dated Tuesday", () => {
      expect(state.status).toBe("mastered");
      expect(state.masteredOn).toBe("2027-01-12");
    });
  });

  scenario("lots of correct quiz answers without an explanation are not mastery", async ({ given, when, then }) => {
    let events: AttemptEvent[] = [];
    let status = "";
    await given("Amani got every multiple-choice and map task right on three different days", () => {
      events = ["2027-01-11", "2027-01-12", "2027-01-13"].map((d) => attempt("map.scale", d));
    });
    await when("we compute her skill state", () => {
      status = computeSkillStates(events)["map.scale"]!.status;
    });
    await then("the skill is still Practising, because she has not explained it yet", () =>
      expect(status).toBe("practising"),
    );
  });

  scenario("mastery is never taken away from a child", async ({ given, when, then }) => {
    let events: AttemptEvent[] = [];
    let status = "";
    await given("Amani mastered a skill and then got a review question wrong", () => {
      events = [
        attempt("map.direction", "2027-01-11"),
        attempt("map.direction", "2027-01-12", { kind: "explain" }),
        attempt("map.direction", "2027-01-13", { context: "review", correct: false }),
      ];
    });
    await when("we compute her skill state", () => {
      status = computeSkillStates(events)["map.direction"]!.status;
    });
    await then("the skill stays Mastered (the review schedule tightens instead)", () => expect(status).toBe("mastered"));
  });
});

feature("Spaced review mixes topics", () => {
  scenario("due reviews alternate between sub-strands", async ({ given, when, then }) => {
    let queue: string[] = [];
    const topics = { "map.elements": "ss-1-1", "map.scale": "ss-1-1", "features.mountains": "ss-1-3", "features.lakes-rift": "ss-1-3" };
    let events: AttemptEvent[] = [];
    await given("Amani practised two map skills and then two physical-feature skills last week", () => {
      events = [
        attempt("map.elements", "2027-01-04"),
        attempt("map.scale", "2027-01-05"),
        attempt("features.mountains", "2027-01-06"),
        attempt("features.lakes-rift", "2027-01-07"),
      ];
    });
    await when("she opens a review session on Monday", () => {
      queue = buildReviewQueue(computeSkillStates(events), "2027-01-11", topics).map((i) => i.skillId);
    });
    await then("no two reviews in a row come from the same sub-strand", () => {
      for (let i = 1; i < queue.length; i++) expect(topics[queue[i] as keyof typeof topics]).not.toBe(topics[queue[i - 1] as keyof typeof topics]);
      expect(queue).toHaveLength(4);
    });
  });
});

feature("The weekly report counts each answer once", () => {
  scenario("an answer sent twice (a retried sync) is counted once (findings register CR28)", async ({ given, when, then }) => {
    let events: AttemptEvent[] = [];
    let line: { attemptsThisWeek: number; correctThisWeek: number; needsSupport: boolean } | undefined;
    await given("Amani answered one question wrongly and one correctly, and the wrong one reached the server twice", () => {
      const wrong = attempt("map.scale", "2027-01-11", { correct: false });
      events = [wrong, { ...wrong }, attempt("map.scale", "2027-01-12")];
    });
    await when("the parent opens the weekly report", () => {
      line = weeklySummary(events, "2027-01-17", ["map.scale"]).lines.find((l) => l.skillId === "map.scale");
    });
    await then("it shows two attempts, one correct, and half correct is not 'needs support'", () => {
      expect(line).toMatchObject({ attemptsThisWeek: 2, correctThisWeek: 1, needsSupport: false });
    });
  });
});

feature("Any skill id works", () => {
  scenario("a skill called 'constructor' is tracked like any other (findings register CR29)", async ({ given, when, then }) => {
    let events: AttemptEvent[] = [];
    let state: ReturnType<typeof computeSkillStates> = {};
    await given("a content pack whose skill id happens to be a built-in name", () => {
      events = [attempt("constructor", "2027-01-11"), attempt("__proto__", "2027-01-11")];
    });
    await when("we compute the skill states", () => {
      state = computeSkillStates(events);
    });
    await then("each skill has its own state", () => {
      expect(Object.keys(state).sort()).toEqual(["__proto__", "constructor"]);
      expect(state["constructor"]!.attempts).toBe(1);
    });
  });
});
