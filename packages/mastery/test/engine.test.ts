import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildReviewQueue,
  computeSkillStates,
  localDay,
  weeklySummary,
  type AttemptEvent,
  type MasteryRules,
} from "../src/index.js";

interface Fixture {
  rules: MasteryRules;
  cases: { name: string; events: AttemptEvent[]; expected: Record<string, Record<string, unknown>> }[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL("../fixtures/conformance.json", import.meta.url), "utf8"),
);

describe("conformance fixtures (shared with the Unity C# engine)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const states = computeSkillStates(c.events, fixture.rules);
      for (const [skillId, expected] of Object.entries(c.expected)) {
        expect(states[skillId]).toMatchObject(expected);
      }
    });
  }
});

const ev = (id: string, skillId: string, at: string, correct = true, kind: AttemptEvent["kind"] = "choice"): AttemptEvent => ({
  eventId: id,
  profileId: "p",
  skillId,
  taskId: "t",
  kind,
  correct,
  occurredAt: at,
  context: "mission",
});

describe("review queue", () => {
  it("treats a skill id like 'constructor' as an unknown topic, not a built-in (findings register CR29)", () => {
    const states = computeSkillStates([ev("1", "constructor", "2027-01-11T07:00:00Z")]);
    expect(buildReviewQueue(states, "2027-01-12", {})).toEqual([{ skillId: "constructor", topic: "_", dueDay: "2027-01-12" }]);
  });
  it("interleaves topics and puts the most overdue first", () => {
    const events = [
      ev("1", "map.a", "2027-01-01T07:00:00Z"),
      ev("2", "map.b", "2027-01-02T07:00:00Z"),
      ev("3", "feat.a", "2027-01-03T07:00:00Z"),
      ev("4", "feat.b", "2027-01-04T07:00:00Z"),
      ev("5", "later", "2027-01-20T07:00:00Z"),
    ];
    const states = computeSkillStates(events);
    const topics = { "map.a": "ss-1-1", "map.b": "ss-1-1", "feat.a": "ss-1-3", "feat.b": "ss-1-3", later: "ss-1-3" };
    const q = buildReviewQueue(states, "2027-01-10", topics, 10);
    expect(q.map((i) => i.skillId)).toEqual(["map.a", "feat.a", "map.b", "feat.b"]);
  });

  it("respects the session limit", () => {
    const events = ["a", "b", "c", "d", "e", "f"].map((s, i) => ev(String(i), s, "2027-01-01T07:00:00Z"));
    expect(buildReviewQueue(computeSkillStates(events), "2027-01-05", {}, 3)).toHaveLength(3);
  });
});

describe("weekly summary", () => {
  it("reports mastered-this-week and needs-support without any time-on-screen numbers", () => {
    const events = [
      ev("1", "A", "2027-01-11T07:00:00Z"),
      ev("2", "A", "2027-01-12T07:00:00Z", true, "explain"),
      ev("3", "B", "2027-01-12T07:00:00Z", false),
      ev("4", "B", "2027-01-13T07:00:00Z", false),
      ev("5", "B", "2027-01-13T07:05:00Z", true),
    ];
    const s = weeklySummary(events, "2027-01-17", ["A", "B", "C"]);
    expect(s.fromDay).toBe("2027-01-11");
    expect(s.activeDays).toBe(3);
    expect(s.skillsMasteredThisWeek).toBe(1);
    const byId = Object.fromEntries(s.lines.map((l) => [l.skillId, l]));
    expect(byId.A!.masteredThisWeek).toBe(true);
    expect(byId.B!.needsSupport).toBe(true);
    expect(byId.C!.status).toBe("not-started");
    expect(Object.keys(s)).not.toContain("minutes");
  });
  it("counts an event delivered twice only once (findings register CR28)", () => {
    const wrong = ev("w", "B", "2027-01-12T07:00:00Z", false);
    const s = weeklySummary([wrong, { ...wrong }, ev("r", "B", "2027-01-13T07:00:00Z")], "2027-01-17", ["B"]);
    expect(s.lines[0]).toMatchObject({ attemptsThisWeek: 2, correctThisWeek: 1, needsSupport: false });
  });
});

describe("localDay", () => {
  it("uses the configured offset", () => {
    expect(localDay("2027-01-11T21:00:00Z", 180)).toBe("2027-01-12");
    expect(localDay("2027-01-11T21:00:00Z", 0)).toBe("2027-01-11");
  });
});
