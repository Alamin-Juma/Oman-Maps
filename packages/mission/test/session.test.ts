import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { validatePack } from "@dunialab/content";
import { createMissionSession, uuid } from "../src/index.js";

const require = createRequire(import.meta.url);
const pack = validatePack(JSON.parse(readFileSync(require.resolve("@dunialab/content/packs/kenya-explorer.json"), "utf8"))).pack!;
const start = (missionId = "m1-broken-map") =>
  createMissionSession({ pack, missionId, profileId: "p", now: () => "2027-01-11T06:00:00Z", newId: (() => { let i = 0; return () => `id-${++i}`; })() });

describe("MissionSession", () => {
  it("rejects unknown missions", () => {
    expect(() => start("nope")).toThrow(/mission "nope" not found/);
  });

  it("refuses answers that do not fit the current task", async () => {
    const s = start(); // first task is a choice
    expect(() => s.answerLocate("nairobi")).toThrow(/not valid now/);
    await expect(s.answerExplain("x", "en")).rejects.toThrow(/not valid now/);
  });

  it("requires the exact set of correct options (order-free)", () => {
    const s = start();
    expect(s.answerChoice(["title", "key"]).correct).toBe(false);
    const s2 = start();
    expect(s2.answerChoice(["title"]).correct).toBe(true);
  });

  it("returns the teacher explanation after every answer", () => {
    const s = start();
    expect(s.answerChoice(["key"]).explanation.en).toMatch(/title tells you/i);
  });

  it("falls back to the local checker when an online checker throws", async () => {
    const s = start();
    s.answerChoice(["title"]);
    s.answerChoice(["key"]);
    s.answerChoice(["compass"]);
    const r = await s.answerExplain("without a key you do not know what the symbols mean and without a scale you cannot tell the distance", "en", () => {
      throw new Error("offline");
    });
    expect(r.feedback).toMatchObject({ outcome: "accepted", checkedBy: "local" });
  });

  it("never gives a second hint even if a checker asks for one", async () => {
    const s = start();
    s.answerChoice(["title"]);
    s.answerChoice(["key"]);
    s.answerChoice(["compass"]);
    const hintAlways = () => ({ outcome: "hint" as const, hintId: "h-key", criteriaMet: [], confidence: 0.9, checkedBy: "ai" as const, flagForTeacher: false });
    await s.answerExplain("hmm maybe", "en", hintAlways);
    expect(s.state().phase).toBe("hint");
    expect(s.state().hint?.id).toBe("h-key");
    const second = await s.answerExplain("hmm maybe again", "en", hintAlways);
    expect(second.feedback.outcome).toBe("choice-follow-up");
    expect(s.state().phase).toBe("follow-up");
    expect(s.state().task?.id).toBe("m1-t4-followup");
  });

  it("exposes the follow-up as a choice task and records it as kind follow-up", async () => {
    const s = start();
    s.answerChoice(["title"]);
    s.answerChoice(["key"]);
    s.answerChoice(["compass"]);
    await s.answerExplain("no", "en");
    expect(s.state().task?.type).toBe("choice");
    s.answerChoice(["a"]);
    expect(s.events().at(-1)).toMatchObject({ kind: "follow-up", taskId: "m1-t4-followup", skillId: "map.elements" });
    expect(s.state()).toMatchObject({ phase: "done", task: null });
  });

  it("generates v4 UUIDs even where crypto.randomUUID is unavailable (plain-HTTP LAN testing)", () => {
    const original = globalThis.crypto.randomUUID;
    try {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
      const ids = new Set(Array.from({ length: 50 }, () => uuid()));
      expect(ids.size).toBe(50);
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });

  it("supports review context for spaced-review sessions", () => {
    const s = createMissionSession({ pack, missionId: "m1-broken-map", profileId: "p", context: "review" });
    s.answerChoice(["title"]);
    expect(s.events()[0]!.context).toBe("review");
    expect(s.events()[0]!.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
