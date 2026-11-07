import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkExplanationLocally, findExplainTask, validatePack, type ContentPack } from "../src/index.js";

const raw = JSON.parse(readFileSync(new URL("../packs/kenya-explorer.json", import.meta.url), "utf8"));

describe("kenya-explorer pack", () => {
  const result = validatePack(raw);

  it("is valid", () => {
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("matches the fixed MVP scope (2 sub-strands, 6 missions, each ending in an explanation)", () => {
    const pack = result.pack!;
    expect(pack.subStrands.filter((s) => s.inMvp).map((s) => s.code)).toEqual(["1.1", "1.3"]);
    expect(pack.missions).toHaveLength(6);
    for (const m of pack.missions) expect(m.tasks.at(-1)?.type).toBe("explain");
  });

  it("keeps every feature anchor inside the printed bounds", () => {
    const pack = result.pack!;
    const [[w, s], [e, n]] = pack.printTarget.bounds;
    for (const f of pack.features) {
      const [lon, lat] = f.anchor;
      expect(lon >= w && lon <= e && lat >= s && lat <= n, f.id).toBe(true);
    }
  });

  it("accepts every exemplar with the offline checker (rubric sanity)", () => {
    const pack = result.pack!;
    for (const m of pack.missions) {
      for (const t of m.tasks) {
        if (t.type !== "explain") continue;
        for (const locale of ["en", "sw"] as const) {
          const fb = checkExplanationLocally(t, t.exemplar[locale], locale);
          expect(fb.outcome, `${t.id} ${locale}`).toBe("accepted");
        }
      }
    }
  });
});

describe("validatePack catches cross-reference errors", () => {
  it("rejects an unknown feature and a mission without an explanation", () => {
    const broken = structuredClone(raw) as ContentPack;
    const m = broken.missions[0]!;
    m.tasks = m.tasks.filter((t) => t.type !== "explain");
    m.tasks.push({ ...(broken.missions[1]!.tasks[1] as object), id: "x-locate", featureId: "atlantis" } as never);
    const r = validatePack(broken);
    expect(r.ok).toBe(false);
    const msgs = r.issues.map((i) => i.message).join("\n");
    expect(msgs).toMatch(/must end in an explanation/);
    expect(msgs).toMatch(/unknown feature "atlantis"/);
  });
});

describe("offline explanation checker", () => {
  const pack = validatePack(raw).pack!;
  const task = findExplainTask(pack, "m4-t4-explain")!;

  it("accepts a child's paraphrase that meets 2 criteria", () => {
    const fb = checkExplanationLocally(task, "because the mountain is very high up so it is colder", "en");
    expect(fb.outcome).toBe("accepted");
    expect(fb.checkedBy).toBe("local");
    expect(fb.criteriaMet).toEqual(expect.arrayContaining(["height", "cooler"]));
  });

  it("accepts code-switched English/Kiswahili", () => {
    const fb = checkExplanationLocally(task, "Mlima uko juu sana so it is cold", "sw");
    expect(fb.outcome).toBe("accepted");
  });

  it("gives one targeted hint, then falls back to multiple choice", () => {
    const first = checkExplanationLocally(task, "because it is a big mountain", "en", 1);
    expect(first.outcome).toBe("hint");
    expect(task.hints.map((h) => h.id)).toContain(first.hintId);

    const second = checkExplanationLocally(task, "because it is a big mountain", "en", 2);
    expect(second.outcome).toBe("choice-follow-up");
  });

  it("does not accept empty or very short answers", () => {
    expect(checkExplanationLocally(task, "  idk ", "en").outcome).toBe("choice-follow-up");
  });
});
