import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validatePack, type ContentPack } from "@dunialab/content";
import { selectPacks } from "../src/lib/pack-selection.js";

const kenya = validatePack(JSON.parse(readFileSync(new URL("../../../packages/content/packs/kenya-explorer.json", import.meta.url), "utf8"))).pack!;
const pack = (id: string, grade: number, status: ContentPack["review"]["status"]): ContentPack => ({
  ...kenya,
  id,
  grade,
  review: { ...kenya.review, status },
});

describe("selectPacks", () => {
  it("treats 'teacher-review' as not approved", () => {
    const r = selectPacks([pack("a", 5, "teacher-review")], { production: true, allowDraft: false });
    expect(r.packs).toEqual([]);
    expect(r.withheld).toEqual(["a"]);
  });

  it("ignores the override outside production (development shows everything anyway)", () => {
    const r = selectPacks([pack("a", 5, "draft")], { production: false, allowDraft: false });
    expect(r.packs.map((p) => p.id)).toEqual(["a"]);
    expect(r.withheld).toEqual([]);
  });

  it("orders offered packs by grade, then id, whatever the input order", () => {
    const r = selectPacks([pack("b", 6, "approved"), pack("c", 5, "approved"), pack("a", 6, "approved")], { production: true, allowDraft: false });
    expect(r.packs.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });

  it("reports drafts only when it is actually showing one", () => {
    expect(selectPacks([pack("a", 5, "approved")], { production: false, allowDraft: true }).showingDrafts).toBe(false);
    expect(selectPacks([pack("a", 5, "draft")], { production: true, allowDraft: true }).showingDrafts).toBe(true);
  });

  it("handles no packs at all", () => {
    expect(selectPacks([], { production: true, allowDraft: false })).toEqual({ packs: [], withheld: [], showingDrafts: false });
  });

  it("does not modify the input list", () => {
    const input = [pack("b", 6, "approved"), pack("a", 5, "approved")];
    selectPacks(input, { production: true, allowDraft: false });
    expect(input.map((p) => p.id)).toEqual(["b", "a"]);
  });
});
