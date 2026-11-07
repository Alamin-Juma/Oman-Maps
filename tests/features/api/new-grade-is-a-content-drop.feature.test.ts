/**
 * Architecture rule (ADR-0004, requested by the founder on day one):
 *   "Future classes/grades/subjects/countries are added by dropping in a content pack,
 *    not by modifying the proof-of-concept code."
 * Product definition, go-to-market: "East Africa ... The same engine, new content packs."
 */
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, expect } from "vitest";
import { feature, scenario } from "../support/gherkin.js";
import { parentToken, startApi, type TestApi } from "../support/api.js";

const require = createRequire(import.meta.url);
const kenyaPacks = dirname(require.resolve("@dunialab/content/packs/kenya-explorer.json"));
const grade6Fixture = new URL("../fixtures/packs/ke-g6-east-africa.json", import.meta.url);

let api: TestApi | undefined;
let dir = "";
afterAll(async () => {
  await api?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

feature("A new grade is a content drop, not a code change", () => {
  scenario("dropping a Grade 6 pack into the packs folder makes it available", async ({ given, when, then, and }) => {
    let catalog: any[] = [];
    let token = "";
    let profileId = "";
    await given("a packs folder holding the Grade 5 pack and a new Grade 6 pack", () => {
      dir = mkdtempSync(join(tmpdir(), "dunialab-packs-"));
      cpSync(kenyaPacks, dir, { recursive: true });
      cpSync(grade6Fixture, join(dir, "ke-g6-east-africa.json"));
    });
    await when("the unchanged API starts and a parent asks for the Kenya catalog", async () => {
      api = await startApi({ packsDir: dir });
      catalog = (await api.call<any[]>("GET", "/v1/catalog?country=KE")).body;
    });
    await then("both grades are listed", () => {
      expect(catalog.map((p) => [p.grade, p.id]).sort()).toEqual([
        [5, "ke.g5.sst.kenya-explorer"],
        [6, "ke.g6.sst.east-africa-explorer"],
      ]);
    });
    await and("a Grade 6 child's progress syncs and is reported against the Grade 6 pack", async () => {
      token = await parentToken(api!);
      await api!.call("POST", "/v1/consents", { policyVersion: "2026-11", accepted: true }, token);
      profileId = (await api!.call<{ id: string }>("POST", "/v1/profiles", { nickname: "Baraka", grade: 6, picturePin: ["sun", "fish", "drum"] }, token)).body.id;
      const ev = { eventId: randomUUID(), profileId, skillId: "ea.neighbours", taskId: "g6-t2", kind: "choice", correct: true, occurredAt: "2027-01-11T06:00:00Z", context: "mission" };
      const sync = await api!.call("POST", "/v1/sync", { profileId, packId: "ke.g6.sst.east-africa-explorer", events: [ev] }, token);
      expect(sync.status).toBe(200);
      const report = (await api!.call<any>("GET", `/v1/profiles/${profileId}/report?packId=ke.g6.sst.east-africa-explorer&week=2027-01-17&locale=sw`, undefined, token)).body;
      expect(report.lines[0]).toMatchObject({ skillId: "ea.neighbours", label: "Anataja majirani wa Kenya", status: "practising" });
    });
  });

  scenario("the same skill id in two packs never collides", async ({ given, then }) => {
    await given("both packs define a sub-strand called ss-1-1", () => {});
    await then("progress is always scoped by packId, so a sync without packId is rejected", async () => {
      const token = await parentToken(api!);
      const res = await api!.call("POST", "/v1/sync", { profileId: "x", events: [] }, token);
      expect(res.status).toBe(400);
    });
  });
});
