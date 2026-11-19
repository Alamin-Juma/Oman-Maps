/**
 * E2E: a long offline stretch still syncs (findings register R4).
 *
 * A child plays offline for weeks and builds up 1,200 events. The web app's own queue and sync code
 * (EventQueue + syncInBatches + DuniaApi) sends them to the REAL API on REAL Postgres. Before the fix
 * the whole backlog went in one request, which the API rejects above 500, so it could never sync.
 *
 * Positive control: the API really does refuse one oversized request; without that, "batches got
 * through" would prove nothing about the limit.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYNC_MAX_EVENTS, type AttemptEvent } from "@dunialab/mastery";
import { DuniaApi } from "../../../apps/web/src/lib/api.js";
import { EventQueue, type KeyValueStorage } from "../../../apps/web/src/lib/queue.js";
import { syncInBatches } from "../../../apps/web/src/lib/sync.js";
import { call, databaseReachable, startApi, type RunningApi } from "../support/server.js";

const PACK = "ke.g5.sst.kenya-explorer";
const BACKLOG = 1200;
const reachable = await databaseReachable();

const memoryStorage = (): KeyValueStorage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe.skipIf(!reachable)("E2E: a 1,200-event offline backlog syncs to the real API", () => {
  let api: RunningApi;
  let token = "";
  let profileId = "";
  const events = (n: number): AttemptEvent[] =>
    Array.from({ length: n }, (_, i) => ({
      eventId: randomUUID(),
      profileId,
      skillId: "features.mountains",
      taskId: "m4-t2-highest",
      kind: "choice",
      correct: i % 3 !== 0,
      occurredAt: new Date(Date.UTC(2027, 0, 11, 6, 0, i)).toISOString(),
      context: "mission",
    }));

  beforeAll(async () => {
    api = await startApi();
    const reg = await call<{ token: string }>(api.url, "POST", "/v1/auth/register", { email: `e2e-${randomUUID()}@example.com`, password: "a long enough password" });
    token = reg.body.token;
    await call(api.url, "POST", "/v1/consents", { policyVersion: "2026-11", accepted: true }, token);
    profileId = (await call<{ id: string }>(api.url, "POST", "/v1/profiles", { nickname: "Amani", grade: 5, picturePin: ["lion", "mango", "drum"] }, token)).body.id;
  }, 120_000);
  afterAll(async () => api?.stop());

  it("positive control: the API refuses a single request above the shared limit", async () => {
    const r = await call(api.url, "POST", "/v1/sync", { profileId, packId: PACK, events: events(SYNC_MAX_EVENTS + 1) }, token);
    expect(r.status).toBe(400);
  });

  it("the web app's batched sync delivers the whole backlog, once", async () => {
    const queue = new EventQueue(memoryStorage());
    queue.add(PACK, events(BACKLOG));
    const client = new DuniaApi(api.url, () => token);

    const first = await syncInBatches(queue, client, PACK, profileId);
    expect(first.error).toBeUndefined();
    expect(first).toMatchObject({ sent: BACKLOG, accepted: BACKLOG, duplicates: 0, remaining: 0 });

    // Nothing is left to send, and a forced re-send is recognised as duplicates, not double counted.
    expect((await syncInBatches(queue, client, PACK, profileId)).sent).toBe(0);
    const again = new EventQueue(memoryStorage());
    again.add(PACK, queue.all(PACK, profileId));
    const resend = await syncInBatches(again, client, PACK, profileId);
    expect(resend).toMatchObject({ sent: BACKLOG, accepted: 0, duplicates: BACKLOG });
  }, 120_000);
});
