/**
 * Architecture rule (ADR-0004, requested by the founder on day one):
 *   "Future classes/grades/subjects/countries are added by dropping in a content pack,
 *    not by modifying the proof-of-concept code."
 * Product definition, go-to-market: "East Africa ... The same engine, new content packs."
 *
 * The packs folder and the API are set up once, before any scenario, so each scenario can also be
 * run on its own (findings register CR46).
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect } from "vitest";
import { feature, scenario } from "../support/gherkin.js";
import { consentedParentToken, startApi, type TestApi } from "../support/api.js";

const require = createRequire(import.meta.url);
const kenyaPacks = dirname(require.resolve("@dunialab/content/packs/kenya-explorer.json"));
const grade6Fixture = new URL("../fixtures/packs/ke-g6-east-africa.json", import.meta.url);
const GRADE6 = "ke.g6.sst.east-africa-explorer";
/** A second Grade 6 pack with the SAME skill ids, to prove progress never mixes between packs. */
const GRADE6_COPY = "ke.g6.sst.east-africa-explorer-two";

let api: TestApi;
let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "dunialab-packs-"));
  cpSync(kenyaPacks, dir, { recursive: true });
  cpSync(grade6Fixture, join(dir, "ke-g6-east-africa.json"));
  const copy = JSON.parse(readFileSync(grade6Fixture, "utf8"));
  copy.id = GRADE6_COPY;
  writeFileSync(join(dir, "ke-g6-east-africa-two.json"), JSON.stringify(copy));
  api = await startApi({ packsDir: dir });
}, 60_000);

afterAll(async () => {
  await api?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A consented parent with one Grade 6 child; returns the token and the child's id. */
async function grade6Child() {
  const token = await consentedParentToken(api);
  const created = await api.call<{ id: string }>("POST", "/v1/profiles", { nickname: "Baraka", grade: 6, picturePin: ["sun", "fish", "drum"] }, token);
  expect(created.status).toBe(201);
  return { token, profileId: created.body.id };
}

const event = (profileId: string, correct: boolean) => ({
  eventId: randomUUID(), profileId, skillId: "ea.neighbours", taskId: "g6-t2", kind: "choice", correct, occurredAt: "2027-01-11T06:00:00Z", context: "mission",
});

feature("A new grade is a content drop, not a code change", () => {
  scenario("dropping a Grade 6 pack into the packs folder makes it available", async ({ given, when, then, and }) => {
    let catalog: any[] = [];
    await given("a packs folder holding the Grade 5 pack and new Grade 6 packs", () => {});
    await when("the unchanged API starts and a parent asks for the Kenya catalog", async () => {
      catalog = (await api.call<any[]>("GET", "/v1/catalog?country=KE")).body;
    });
    await then("every grade is listed", () => {
      expect(catalog.map((p) => [p.grade, p.id]).sort()).toEqual([
        [5, "ke.g5.sst.kenya-explorer"],
        [6, GRADE6],
        [6, GRADE6_COPY],
      ]);
    });
    await and("a Grade 6 child's progress syncs and is reported against the Grade 6 pack", async () => {
      const { token, profileId } = await grade6Child();
      const sync = await api.call("POST", "/v1/sync", { profileId, packId: GRADE6, events: [event(profileId, true)] }, token);
      expect(sync.status).toBe(200);
      const report = (await api.call<any>("GET", `/v1/profiles/${profileId}/report?packId=${GRADE6}&week=2027-01-17&locale=sw`, undefined, token)).body;
      expect(report.lines[0]).toMatchObject({ skillId: "ea.neighbours", label: "Anataja majirani wa Kenya", status: "practising" });
    });
  });

  scenario("the same skill id in two packs never collides (findings register CR45)", async ({ given, when, then }) => {
    let child = { token: "", profileId: "" };
    let reports: any[] = [];
    await given("two packs that both define the skill 'ea.neighbours'", () => {});
    await when("a child answers it correctly in one pack and wrongly in the other", async () => {
      child = await grade6Child();
      const { token, profileId } = child;
      expect((await api.call("POST", "/v1/sync", { profileId, packId: GRADE6, events: [event(profileId, true)] }, token)).status).toBe(200);
      expect((await api.call("POST", "/v1/sync", { profileId, packId: GRADE6_COPY, events: [event(profileId, false)] }, token)).status).toBe(200);
      reports = await Promise.all(
        [GRADE6, GRADE6_COPY].map(async (packId) =>
          (await api.call<any>("GET", `/v1/profiles/${profileId}/report?packId=${packId}&week=2027-01-17&locale=en`, undefined, token)).body,
        ),
      );
    });
    await then("each pack's report holds only its own answer", () => {
      const line = (r: any) => r.lines.find((l: any) => l.skillId === "ea.neighbours");
      expect(line(reports[0])).toMatchObject({ attemptsThisWeek: 1, correctThisWeek: 1 });
      expect(line(reports[1])).toMatchObject({ attemptsThisWeek: 1, correctThisWeek: 0 });
    });
  });

  scenario("progress always names its pack: a sync without packId is refused", async ({ then }) => {
    await then("the request is rejected with 400", async () => {
      const { token, profileId } = await grade6Child();
      expect((await api.call("POST", "/v1/sync", { profileId, events: [] }, token)).status).toBe(400);
    });
  });

  scenario("a catalogue filter the API does not know is refused, not silently ignored (findings register CR19)", async ({ when, then }) => {
    let known = 0;
    let unknown = 0;
    let knownBody: any[] = [];
    await when("a client filters by grade and by a misspelt 'subjects'", async () => {
      const ok = await api.call<any[]>("GET", "/v1/catalog?country=KE&grade=6");
      known = ok.status;
      knownBody = ok.body;
      unknown = (await api.call("GET", "/v1/catalog?country=KE&grade=6&subjects=Social%20Studies")).status;
    });
    await then("the known filters work and the unknown one is a 400", () => {
      expect(known).toBe(200);
      expect(knownBody.map((p) => p.id).sort()).toEqual([GRADE6, GRADE6_COPY]);
      expect(unknown).toBe(400);
    });
  });
});
