/**
 * Product definition, "Engineering decisions that protect the product":
 *   "Content packs are data, validated before they ship."
 * A pack that passes validation must behave as its author meant: the local checker counts
 * distinct rubric criteria, the hint shown is the hint chosen, and the country code means one thing.
 * Findings register CR30, CR31, CR32 (first CodeRabbit review).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect } from "vitest";
import { validatePack, type ContentPack, type ExplainTask } from "@dunialab/content";
import { feature, scenario } from "../support/gherkin.js";

const require = createRequire(import.meta.url);
const original = JSON.parse(readFileSync(require.resolve("@dunialab/content/packs/kenya-explorer.json"), "utf8")) as ContentPack;
const copy = (): ContentPack => structuredClone(original);
const firstExplain = (pack: ContentPack): ExplainTask => {
  for (const m of pack.missions) for (const t of m.tasks) if (t.type === "explain") return t;
  throw new Error("pack has no explanation task");
};

feature("A content pack that validates behaves as its author meant", () => {
  scenario("positive control: the shipped pack is valid", async ({ then }) => {
    await then("it has no issues", () => expect(validatePack(copy()).issues).toEqual([]));
  });

  scenario("a rubric that repeats a criterion id is refused (CR30)", async ({ given, when, then }) => {
    let pack = copy();
    let issues: string[] = [];
    await given("an explanation task whose rubric lists the same criterion twice, so one idea could count as two", () => {
      pack = copy();
      const task = firstExplain(pack);
      task.rubric.criteria.push({ ...task.rubric.criteria[0]! });
    });
    await when("the pack is validated", () => {
      issues = validatePack(pack).issues.map((i) => `${i.path}: ${i.message}`);
    });
    await then("it is refused, naming the repeated criterion", () => {
      expect(issues.some((i) => /duplicate criterion id/.test(i))).toBe(true);
    });
  });

  scenario("a task that repeats a hint id is refused (CR31)", async ({ given, when, then }) => {
    let pack = copy();
    let issues: string[] = [];
    await given("an explanation task with two hints sharing one id", () => {
      pack = copy();
      const task = firstExplain(pack);
      task.hints.push({ ...task.hints[0]! });
    });
    await when("the pack is validated", () => {
      issues = validatePack(pack).issues.map((i) => `${i.path}: ${i.message}`);
    });
    await then("it is refused, naming the repeated hint", () => {
      expect(issues.some((i) => /duplicate hint id/.test(i))).toBe(true);
    });
  });

  scenario("the same hint id in two different tasks is fine", async ({ given, then }) => {
    let pack = copy();
    await given("two explanation tasks that both have a hint called 'h1'", () => {
      pack = copy();
      const tasks = pack.missions.flatMap((m) => m.tasks).filter((t): t is ExplainTask => t.type === "explain");
      expect(tasks.length).toBeGreaterThan(1);
      for (const t of tasks.slice(0, 2)) t.hints[0]!.id = "h1";
    });
    await then("the pack is still valid", () => expect(validatePack(pack).issues).toEqual([]));
  });

  scenario("a country code must be upper case, so a catalogue filter always matches it (CR32)", async ({ given, when, then }) => {
    let pack = copy();
    let ok = true;
    await given("a pack whose country is written 'ke'", () => {
      pack = copy();
      (pack as { country: string }).country = "ke";
    });
    await when("the pack is validated", () => {
      ok = validatePack(pack).ok;
    });
    await then("it is refused", () => expect(ok).toBe(false));
  });
});
