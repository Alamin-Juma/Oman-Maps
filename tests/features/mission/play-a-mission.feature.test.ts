/**
 * Product definition, "The child's experience in one session":
 *   "Mission: 3-5 tasks. The questions have fixed answer keys."
 *   "Explain: ... The AI compares it to a scoring rubric and either accepts it or gives one hint."
 *   "Below the threshold the child gets a multiple-choice follow-up instead."
 *   "All three tiers share one mission and mastery layer, so learning results are comparable across them."
 *   "Progress is recorded offline first."
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect } from "vitest";
import { validatePack } from "@dunialab/content";
import { computeSkillStates } from "@dunialab/mastery";
import { createMissionSession } from "@dunialab/mission";
import { feature, scenario } from "../support/gherkin.js";

const require = createRequire(import.meta.url);
const pack = validatePack(JSON.parse(readFileSync(require.resolve("@dunialab/content/packs/kenya-explorer.json"), "utf8"))).pack!;

let ids = 0;
const deps = (day: string) => ({ now: () => `${day}T06:00:00.000Z`, newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}` });

feature("A child plays a mission the same way on every tier, fully offline", () => {
  scenario("completing the mountains mission records exactly one event per task", async ({ given, when, then, and }) => {
    const s = createMissionSession({ pack, missionId: "m4-mountain-expedition", profileId: "p1", ...deps("2027-01-11") });
    await given("Amani starts 'Expedition: the mountains' with no network", () => {
      expect(s.state().phase).toBe("task");
      expect(s.state().total).toBe(4);
    });
    await when("she taps Mount Kenya, picks the highest mountain, taps Mount Elgon and explains well", async () => {
      expect(s.answerLocate("mount-kenya").correct).toBe(true);
      expect(s.answerChoice(["mt-kenya"]).correct).toBe(true);
      expect(s.answerLocate("mount-elgon").correct).toBe(true);
      const r = await s.answerExplain("Mount Kenya is very high so it is much colder than the coast", "en");
      expect(r.feedback.outcome).toBe("accepted");
    });
    await then("the mission is done", () => expect(s.state().phase).toBe("done"));
    await and("four events were queued, each tied to the pack's skill, ready to sync", () => {
      expect(s.events()).toHaveLength(4);
      expect(new Set(s.events().map((e) => e.eventId)).size).toBe(4);
      expect(s.events().every((e) => e.skillId === "features.mountains" && e.profileId === "p1" && e.context === "mission")).toBe(true);
      expect(s.events().at(-1)).toMatchObject({ kind: "explain", correct: true, checkedBy: "local" });
    });
  });

  scenario("a weak explanation gets one hint, then the multiple-choice follow-up", async ({ given, when, then, and }) => {
    const s = createMissionSession({ pack, missionId: "m4-mountain-expedition", profileId: "p1", ...deps("2027-01-11") });
    let hintId: string | null = null;
    await given("Amani reaches the explanation task", () => {
      s.answerLocate("mount-kenya");
      s.answerChoice(["mt-kenya"]);
      s.answerLocate("mount-elgon");
    });
    await when("she writes a weak explanation twice", async () => {
      const first = await s.answerExplain("because it is a big mountain", "en");
      hintId = first.feedback.hintId;
      expect(s.state().phase).toBe("hint");
      await s.answerExplain("because it is a big big mountain", "en");
    });
    await then("she saw one approved hint and is now on the follow-up question", () => {
      expect(hintId).toBeTruthy();
      expect(s.state().phase).toBe("follow-up");
    });
    await and("answering the follow-up finishes the mission and records the explain miss and the follow-up", () => {
      expect(s.answerChoice(["a"]).correct).toBe(true);
      expect(s.state().phase).toBe("done");
      expect(s.events().slice(-2).map((e) => [e.kind, e.correct])).toEqual([
        ["explain", false],
        ["follow-up", true],
      ]);
    });
  });

  scenario("two days of missions make a skill Mastered on the device, before any sync", async ({ given, when, then }) => {
    const events: ReturnType<ReturnType<typeof createMissionSession>["events"]> = [];
    await given("Amani played the mountains mission on Monday (quiz only correct) and Tuesday (all correct)", async () => {
      const mon = createMissionSession({ pack, missionId: "m4-mountain-expedition", profileId: "p1", ...deps("2027-01-11") });
      mon.answerLocate("mount-kenya");
      mon.answerChoice(["kilimanjaro"]);
      mon.answerLocate("mount-elgon");
      await mon.answerExplain("idk", "en");
      mon.answerChoice(["b"]);
      events.push(...mon.events());

      const tue = createMissionSession({ pack, missionId: "m4-mountain-expedition", profileId: "p1", ...deps("2027-01-12") });
      tue.answerLocate("mount-kenya");
      tue.answerChoice(["mt-kenya"]);
      tue.answerLocate("mount-elgon");
      await tue.answerExplain("it is high up so it is colder", "en");
      events.push(...tue.events());
    });
    let status = "";
    await when("the phone computes her progress offline", () => {
      status = computeSkillStates(events)["features.mountains"]!.status;
    });
    await then("the skill shows as Mastered", () => expect(status).toBe("mastered"));
  });

  scenario("an online checker can be plugged in without changing the mission flow", async ({ given, when, then }) => {
    const s = createMissionSession({ pack, missionId: "m4-mountain-expedition", profileId: "p1", ...deps("2027-01-11") });
    let calls = 0;
    await given("a tier provides an online checker (the API)", () => {
      s.answerLocate("mount-kenya");
      s.answerChoice(["mt-kenya"]);
      s.answerLocate("mount-elgon");
    });
    await when("the child explains", async () => {
      await s.answerExplain("cold because high", "en", async () => {
        calls++;
        return { outcome: "accepted", hintId: null, criteriaMet: ["height", "cooler"], confidence: 0.9, checkedBy: "ai", flagForTeacher: false };
      });
    });
    await then("the checker's verdict is used and recorded as AI-checked", () => {
      expect(calls).toBe(1);
      expect(s.events().at(-1)).toMatchObject({ kind: "explain", correct: true, checkedBy: "ai" });
    });
  });
});
