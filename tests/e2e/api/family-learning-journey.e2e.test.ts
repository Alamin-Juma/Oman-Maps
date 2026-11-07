/**
 * E2E: the full MVP data path through the REAL system:
 *   parent signs up -> consents -> adds child -> child plays offline ->
 *   phone syncs (with a retry) -> server restarts -> parent reads the weekly report.
 * Real HTTP, real Postgres, real content pack. Only the paid AI is off (offline checker answers).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, databaseReachable, startApi, type RunningApi } from "../support/server.js";

const PACK = "ke.g5.sst.kenya-explorer";
const reachable = await databaseReachable();

describe.skipIf(!reachable)("E2E: a family's first week with Kenya Explorer", () => {
  let api: RunningApi;
  const email = `e2e-${randomUUID()}@example.com`;
  const password = "a long enough password";
  let token = "";
  let profileId = "";

  beforeAll(async () => {
    api = await startApi();
  });
  afterAll(async () => api?.stop());

  it("health reports the Postgres store and the content pack", async () => {
    const r = await call(api.url, "GET", "/health");
    expect(r.body).toMatchObject({ status: "ok", store: "postgres" });
    expect(r.body.packs).toBeGreaterThanOrEqual(1);
  });

  it("parent signs up, consents and adds a child", async () => {
    const reg = await call<{ token: string }>(api.url, "POST", "/v1/auth/register", { email, password });
    expect(reg.status).toBe(201);
    token = reg.body.token;

    expect((await call(api.url, "POST", "/v1/profiles", { nickname: "Amani", grade: 5, picturePin: ["lion", "mango", "drum"] }, token)).status).toBe(403);
    expect((await call(api.url, "POST", "/v1/consents", { policyVersion: "2026-11", accepted: true }, token)).status).toBe(201);

    const p = await call<{ id: string }>(api.url, "POST", "/v1/profiles", { nickname: "Amani", grade: 5, picturePin: ["lion", "mango", "drum"] }, token);
    expect(p.status).toBe(201);
    profileId = p.body.id;
  });

  it("the child's explanation is checked (offline rubric when the AI is off)", async () => {
    const r = await call(api.url, "POST", "/v1/explanations/check", {
      packId: PACK,
      taskId: "m4-t4-explain",
      answer: "Mount Kenya is high up so it is colder than Mombasa at the coast",
      locale: "en",
    }, token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: "accepted", checkedBy: "local" });
  });

  it("offline events sync, a retry is not double counted, and state survives a server restart", async () => {
    const events = [
      { eventId: randomUUID(), profileId, skillId: "features.mountains", taskId: "m4-t2-highest", kind: "choice", correct: true, occurredAt: "2027-01-11T06:00:00Z", context: "mission" },
      { eventId: randomUUID(), profileId, skillId: "features.mountains", taskId: "m4-t4-explain", kind: "explain", correct: true, occurredAt: "2027-01-12T06:00:00Z", context: "mission", checkedBy: "local" },
      { eventId: randomUUID(), profileId, skillId: "map.scale", taskId: "m3-t1-nakuru", kind: "choice", correct: false, occurredAt: "2027-01-12T06:10:00Z", context: "mission" },
    ];
    const first = await call(api.url, "POST", "/v1/sync", { profileId, packId: PACK, events }, token);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ accepted: 3, duplicates: 0 });

    const retry = await call(api.url, "POST", "/v1/sync", { profileId, packId: PACK, events }, token);
    expect(retry.body).toMatchObject({ accepted: 0, duplicates: 3 });

    if (api.restart) await api.restart();

    const login = await call<{ token: string }>(api.url, "POST", "/v1/auth/login", { email, password });
    expect(login.status).toBe(200);
    token = login.body.token;

    const report = await call(api.url, "GET", `/v1/profiles/${profileId}/report?packId=${PACK}&week=2027-01-17&locale=sw`, undefined, token);
    expect(report.status).toBe(200);
    const byId = Object.fromEntries(report.body.lines.map((l: any) => [l.skillId, l]));
    expect(byId["features.mountains"]).toMatchObject({ status: "mastered", masteredThisWeek: true });
    expect(byId["map.scale"]).toMatchObject({ status: "practising", needsSupport: true });
    expect(report.body.skillsMasteredThisWeek).toBe(1);
    expect(report.body.pack.title).toBe("Mvumbuzi wa Kenya");
  });

  it("another parent cannot read this child's report", async () => {
    const other = await call<{ token: string }>(api.url, "POST", "/v1/auth/register", { email: `e2e-${randomUUID()}@example.com`, password });
    const r = await call(api.url, "GET", `/v1/profiles/${profileId}/report?packId=${PACK}`, undefined, other.body.token);
    expect(r.status).toBe(404);
  });
});
