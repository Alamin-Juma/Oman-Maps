import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContentRegistry } from "../src/content/content-registry.js";

const defaultDir = ContentRegistry.defaultDirectory();
const tmp = () => mkdtempSync(join(tmpdir(), "registry-"));

describe("ContentRegistry", () => {
  it("loads the shipped packs and indexes tasks including explain follow-ups", () => {
    const r = ContentRegistry.fromDirectory(defaultDir, { allowDraft: true });
    const k = r.get("ke.g5.sst.kenya-explorer")!;
    expect(k.tasks.get("m4-t4-explain")?.task.type).toBe("explain");
    expect(k.tasks.get("m4-t4-followup")?.task.type).toBe("choice");
  });

  it("skips draft packs when drafts are not allowed (production) and warns", () => {
    const warnings: string[] = [];
    const r = ContentRegistry.fromDirectory(defaultDir, { allowDraft: false, warn: (m) => warnings.push(m) });
    expect(r.size).toBe(0);
    expect(warnings[0]).toMatch(/skipping ke\.g5\.sst\.kenya-explorer/);
  });

  it("refuses to start with an invalid pack", () => {
    const dir = tmp();
    const pack = JSON.parse(readFileSync(join(defaultDir, "kenya-explorer.json"), "utf8"));
    pack.missions[0].tasks[0].skillId = "nope";
    writeFileSync(join(dir, "broken.json"), JSON.stringify(pack));
    expect(() => ContentRegistry.fromDirectory(dir, { allowDraft: true })).toThrow(/broken\.json is invalid[\s\S]*unknown skill "nope"/);
  });

  it("refuses two packs with the same id", () => {
    const dir = tmp();
    cpSync(join(defaultDir, "kenya-explorer.json"), join(dir, "a.json"));
    cpSync(join(defaultDir, "kenya-explorer.json"), join(dir, "b.json"));
    expect(() => ContentRegistry.fromDirectory(dir, { allowDraft: true })).toThrow(/duplicate content pack id/);
  });

  it("filters the catalog by country, grade and subject (case-insensitive)", () => {
    const r = ContentRegistry.fromDirectory(defaultDir, { allowDraft: true });
    expect(r.catalog({ country: "ke", grade: 5, subject: "social studies" })).toHaveLength(1);
    expect(r.catalog({ country: "TZ" })).toHaveLength(0);
    expect(r.catalog({ grade: 6 })).toHaveLength(0);
  });
});
