/**
 * Product definition:
 *   "Progress is recorded offline first. Events queue on the device and sync when a
 *    connection appears; nothing in a mission waits on the network."
 *   "Report: the parent gets a weekly summary of what was mastered, what needs support."
 *   North-star: "skills mastered per active learner per month."
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect } from "vitest";
import { SYNC_MAX_EVENTS } from "@dunialab/mastery";
import { feature, scenario } from "../support/gherkin.js";
import { parentToken, startApi, type TestApi } from "../support/api.js";

const PACK = "ke.g5.sst.kenya-explorer";
let api: TestApi;
beforeAll(async () => (api = await startApi()));
afterAll(async () => api.close());

async function familyWithChild() {
  const token = await parentToken(api);
  await api.call("POST", "/v1/consents", { policyVersion: "2026-11", accepted: true }, token);
  const p = await api.call<{ id: string }>("POST", "/v1/profiles", { nickname: "Amani", grade: 5, picturePin: ["lion", "mango", "drum"] }, token);
  return { token, profileId: p.body.id };
}

const event = (profileId: string, skillId: string, occurredAt: string, kind = "choice", correct = true) => ({
  eventId: randomUUID(),
  profileId,
  skillId,
  taskId: kind === "explain" ? "m4-t4-explain" : "m4-t2-highest",
  kind,
  correct,
  occurredAt,
  context: "mission",
  ...(kind === "explain" ? { checkedBy: "local" } : {}),
});

feature("Offline progress syncs without loss or double counting", () => {
  scenario("a week of offline play arrives in one sync and shows in the report", async ({ given, when, then, and }) => {
    let fam: { token: string; profileId: string };
    let events: any[] = [];
    let sync: any;
    let report: any;
    await given("Amani played two missions offline on Monday and Tuesday", async () => {
      fam = await familyWithChild();
      events = [
        event(fam.profileId, "features.mountains", "2027-01-11T06:00:00Z"),
        event(fam.profileId, "features.mountains", "2027-01-12T06:00:00Z", "explain"),
      ];
    });
    await when("the phone comes online and syncs", async () => {
      sync = (await api.call("POST", "/v1/sync", { profileId: fam.profileId, packId: PACK, events }, fam.token)).body;
    });
    await then("the server accepts both events and agrees the skill is mastered", () => {
      expect(sync.accepted).toBe(2);
      expect(sync.duplicates).toBe(0);
      expect(sync.skills.find((s: any) => s.skillId === "features.mountains").status).toBe("mastered");
    });
    await and("the weekly report lists it as mastered this week, with a parent-friendly label", async () => {
      report = (await api.call("GET", `/v1/profiles/${fam.profileId}/report?packId=${PACK}&week=2027-01-17&locale=en`, undefined, fam.token)).body;
      const line = report.lines.find((l: any) => l.skillId === "features.mountains");
      expect(line.masteredThisWeek).toBe(true);
      expect(line.label).toMatch(/mountains/i);
      expect(report.skillsMasteredThisWeek).toBe(1);
    });
  });

  scenario("a flaky connection re-sends the same events and nothing is counted twice", async ({ given, when, then }) => {
    let fam: { token: string; profileId: string };
    let events: any[] = [];
    let second: any;
    await given("a batch of events was already synced", async () => {
      fam = await familyWithChild();
      events = [event(fam.profileId, "map.scale", "2027-01-11T06:00:00Z"), event(fam.profileId, "map.scale", "2027-01-11T06:05:00Z", "choice", false)];
      await api.call("POST", "/v1/sync", { profileId: fam.profileId, packId: PACK, events }, fam.token);
    });
    await when("the phone retries the same batch", async () => {
      second = (await api.call("POST", "/v1/sync", { profileId: fam.profileId, packId: PACK, events }, fam.token)).body;
    });
    await then("both are reported as duplicates and the attempt count is unchanged", () => {
      expect(second.accepted).toBe(0);
      expect(second.duplicates).toBe(2);
      expect(second.skills.find((s: any) => s.skillId === "map.scale").attempts).toBe(2);
    });
  });

  scenario("a phone cannot write progress into another family's child", async ({ given, when, then }) => {
    let a: { token: string; profileId: string };
    let b: { token: string; profileId: string };
    let status = 0;
    await given("two families", async () => {
      a = await familyWithChild();
      b = await familyWithChild();
    });
    await when("family B syncs events claiming to be family A's child", async () => {
      status = (await api.call("POST", "/v1/sync", { profileId: a.profileId, packId: PACK, events: [event(a.profileId, "map.scale", "2027-01-11T06:00:00Z")] }, b.token)).status;
    });
    await then("the server refuses with 404 (it does not reveal the profile exists)", () => expect(status).toBe(404));
  });

  scenario("events for skills that are not in the content pack are rejected", async ({ given, when, then }) => {
    let fam: { token: string; profileId: string };
    let status = 0;
    await given("a family", async () => {
      fam = await familyWithChild();
    });
    await when("a buggy client sends an unknown skill", async () => {
      status = (await api.call("POST", "/v1/sync", { profileId: fam.profileId, packId: PACK, events: [event(fam.profileId, "made.up", "2027-01-11T06:00:00Z")] }, fam.token)).status;
    });
    await then("the whole batch is rejected with 400 so the client can fix and retry", () => expect(status).toBe(400));
  });

  // Findings register R7: the HTTP body limit (Express's default 100 kB) was smaller than a full
  // batch, so a 500-event sync failed with 413 before the server even counted the events.
  scenario("a full batch of the largest events the server accepts gets through", async ({ given, when, then, and }) => {
    let fam: { token: string; profileId: string };
    let full = 0;
    let over = 0;
    const largest = (profileId: string) => ({
      ...event(profileId, "features.mountains", "2027-01-11T06:00:00.123456789+03:00", "explain"),
      // The longest values the event schema allows.
      taskId: "t".repeat(100),
    });
    await given("a family whose child has a full batch waiting", async () => {
      fam = await familyWithChild();
    });
    await when("the phone sends exactly the maximum number of the largest allowed events", async () => {
      const batch = Array.from({ length: SYNC_MAX_EVENTS }, () => largest(fam.profileId));
      full = (await api.call("POST", "/v1/sync", { profileId: fam.profileId, packId: PACK, events: batch }, fam.token)).status;
    });
    await then("the server accepts it", () => expect(full, "status of the full batch").toBe(200));
    await and("one event more is refused as a bad request (400), not as an oversized one (413)", async () => {
      const batch = Array.from({ length: SYNC_MAX_EVENTS + 1 }, () => largest(fam.profileId));
      over = (await api.call("POST", "/v1/sync", { profileId: fam.profileId, packId: PACK, events: batch }, fam.token)).status;
      expect(over).toBe(400);
    });
  });
});
