import { describe, expect, it } from "vitest";
import { SYNC_MAX_EVENTS, type AttemptEvent } from "@dunialab/mastery";
import { browserStorage, EventQueue, isStoredEvent, mergeQueues, safeStorage, type KeyValueStorage } from "../src/lib/queue.js";
import { syncInBatches, type SyncClient } from "../src/lib/sync.js";

const PACK = "p";
let n = 0;
const ev = (profileId = "kid"): AttemptEvent => ({
  eventId: `e${++n}`, profileId, skillId: "s", taskId: "t", kind: "choice", correct: true, occurredAt: "2027-01-11T06:00:00Z", context: "mission",
});
const memory = () => {
  const m = new Map<string, string>();
  const s: KeyValueStorage & { m: Map<string, string> } = { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  return s;
};
const okClient = (): SyncClient & { calls: number[] } => {
  const calls: number[] = [];
  return { calls, sync: async (_p, _k, events) => (calls.push(events.length), { accepted: events.length, duplicates: 0 }) };
};

describe("isStoredEvent", () => {
  const good = { event: ev(), packId: PACK, synced: false };
  it("accepts a well-formed entry", () => expect(isStoredEvent(good)).toBe(true));
  it.each([
    ["null", null],
    ["a string", "x"],
    ["no event", { packId: PACK, synced: false }],
    ["synced not boolean", { ...good, synced: "no" }],
    ["unknown kind", { ...good, event: { ...good.event, kind: "dance" } }],
    ["unknown context", { ...good, event: { ...good.event, context: "party" } }],
    ["correct not boolean", { ...good, event: { ...good.event, correct: 1 } }],
    ["missing eventId", { ...good, event: { ...good.event, eventId: undefined } }],
  ])("rejects %s", (_name, value) => expect(isStoredEvent(value)).toBe(false));
});

describe("EventQueue durability", () => {
  it("is saved and clean on a healthy phone (positive control)", () => {
    const q = new EventQueue(memory());
    q.add(PACK, [ev()]);
    expect(q.notSaved).toBe(false);
    expect(q.recoveredDamaged).toBe(0);
  });

  it("treats a storage that returns false as a failed save, like one that throws", () => {
    const s: KeyValueStorage = { getItem: () => null, setItem: () => false };
    const q = new EventQueue(s);
    q.add(PACK, [ev()]);
    expect(q.notSaved).toBe(true);
    expect(q.all(PACK, "kid")).toHaveLength(1);
  });

  it("keeps working when reading storage itself throws", () => {
    const s: KeyValueStorage = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } };
    const q = new EventQueue(s);
    expect(q.all(PACK, "kid")).toEqual([]);
    q.add(PACK, [ev()]);
    expect(q.all(PACK, "kid")).toHaveLength(1);
    expect(q.notSaved).toBe(true);
  });

  it("marks events synced even while only in memory", () => {
    const s: KeyValueStorage = { getItem: () => null, setItem: () => false };
    const q = new EventQueue(s);
    const e = ev();
    q.add(PACK, [e]);
    q.markSynced([e.eventId]);
    expect(q.unsynced(PACK, "kid")).toEqual([]);
    expect(q.all(PACK, "kid")).toHaveLength(1);
  });

  it("sets aside text that is not JSON", () => {
    const s = memory();
    s.m.set("dunialab.events.v1", "{{{ not json");
    const q = new EventQueue(s);
    expect(q.all(PACK, "kid")).toEqual([]);
    expect(q.recoveredDamaged).toBe(1);
    expect(s.m.get("dunialab.events.v1.damaged")).toBe("{{{ not json");
    expect(s.m.get("dunialab.events.v1")).toBe("[]");
  });

  it("does not crash when the damaged copy cannot be kept either", () => {
    let writes = 0;
    const s: KeyValueStorage = { getItem: () => "{}", setItem: () => { writes++; throw new Error("full"); } };
    const q = new EventQueue(s);
    expect(() => q.all(PACK, "kid")).not.toThrow();
    expect(q.recoveredDamaged).toBe(1);
    expect(writes).toBeGreaterThan(0);
  });

  it("keeps duplicates out when the same events are added twice", () => {
    const q = new EventQueue(memory());
    const e = ev();
    q.add(PACK, [e]);
    q.add(PACK, [e]);
    expect(q.all(PACK, "kid")).toHaveLength(1);
  });
});

describe("safeStorage", () => {
  it("reports whether a write happened", () => {
    expect(safeStorage(memory()).setItem("k", "v")).toBe(true);
    expect(safeStorage({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } }).setItem("k", "v")).toBe(false);
    expect(safeStorage({ getItem: () => null, setItem: () => false }).setItem("k", "v")).toBe(false);
  });
});

describe("syncInBatches", () => {
  it("sends nothing when nothing is waiting", async () => {
    const client = okClient();
    expect(await syncInBatches(new EventQueue(memory()), client, PACK, "kid")).toEqual({ sent: 0, accepted: 0, duplicates: 0, remaining: 0 });
    expect(client.calls).toEqual([]);
  });

  it("splits exactly at the limit: 500 is one request, 501 is two", async () => {
    for (const [count, expected] of [[SYNC_MAX_EVENTS, [SYNC_MAX_EVENTS]], [SYNC_MAX_EVENTS + 1, [SYNC_MAX_EVENTS, 1]]] as const) {
      const q = new EventQueue(memory());
      q.add(PACK, Array.from({ length: count }, () => ev()));
      const client = okClient();
      await syncInBatches(q, client, PACK, "kid");
      expect(client.calls).toEqual(expected);
    }
  });

  it("only ever sends the selected child's events", async () => {
    const q = new EventQueue(memory());
    q.add(PACK, [ev("kid"), ev("sibling"), ev("kid")]);
    const sent: string[] = [];
    await syncInBatches(q, { sync: async (_p, _k, e) => (sent.push(...e.map((x) => x.profileId)), { accepted: e.length, duplicates: 0 }) }, PACK, "kid");
    expect(sent).toEqual(["kid", "kid"]);
    expect(q.unsynced(PACK, "sibling")).toHaveLength(1);
  });

  it("adds up accepted and duplicate counts across batches", async () => {
    const q = new EventQueue(memory());
    q.add(PACK, Array.from({ length: 3 }, () => ev()));
    const r = await syncInBatches(q, { sync: async (_p, _k, e) => ({ accepted: e.length - 1, duplicates: 1 }) }, PACK, "kid", 2);
    expect(r).toMatchObject({ sent: 3, accepted: 1, duplicates: 2, remaining: 0 });
  });

  it("refuses a batch size the server would reject, or a nonsense one", async () => {
    const q = new EventQueue(memory());
    await expect(syncInBatches(q, okClient(), PACK, "kid", SYNC_MAX_EVENTS + 1)).rejects.toThrow(RangeError);
    await expect(syncInBatches(q, okClient(), PACK, "kid", 0)).rejects.toThrow(RangeError);
    await expect(syncInBatches(q, okClient(), PACK, "kid", 2.5)).rejects.toThrow(RangeError);
  });

  it("reports a failure on the first batch with nothing sent", async () => {
    const q = new EventQueue(memory());
    q.add(PACK, [ev()]);
    const r = await syncInBatches(q, { sync: async () => { throw new Error("offline"); } }, PACK, "kid");
    expect(r.sent).toBe(0);
    expect(r.remaining).toBe(1);
    expect((r.error as Error).message).toBe("offline");
  });
});

describe("mergeQueues (two tabs, findings register R3)", () => {
  const entry = (id: string, profileId = "kid", synced = false) => ({ event: { ...ev(profileId), eventId: id }, packId: PACK, synced });

  it("keeps events only the other tab has, after the stored ones, then ours", () => {
    const merged = mergeQueues([entry("theirs")], [entry("ours")], new Set(["ours"]));
    expect(merged.map((m) => m.event.eventId)).toEqual(["theirs", "ours"]);
  });

  it("lets our change win only for events this operation touched", () => {
    const stored = [entry("a", "guest"), entry("b", "guest")];
    const ours = [entry("a", "child"), entry("b", "someone-else")]; // only "a" was adopted here
    const merged = mergeQueues(stored, ours, new Set(["a"]));
    expect(merged.find((m) => m.event.eventId === "a")!.event.profileId).toBe("child");
    expect(merged.find((m) => m.event.eventId === "b")!.event.profileId).toBe("guest");
  });

  it("never loses a 'synced' mark from either side", () => {
    expect(mergeQueues([entry("a", "kid", true)], [entry("a")], new Set())[0]!.synced).toBe(true);
    expect(mergeQueues([entry("a")], [entry("a", "kid", true)], new Set())[0]!.synced).toBe(true);
  });

  it("does not duplicate an event both sides have", () => {
    expect(mergeQueues([entry("a")], [entry("a")], new Set(["a"]))).toHaveLength(1);
  });
});

describe("recovery after a failed save (findings register CR20, CR21)", () => {
  const event = (id: string, profileId: string): AttemptEvent => ({
    eventId: id, profileId, skillId: "s", taskId: "t", kind: "choice", correct: true, occurredAt: "2027-01-11T06:00:00Z", context: "mission",
  });

  it("merges with what another tab stored before writing its own unsaved events", () => {
    const m = new Map<string, string>();
    let full = true;
    const storage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { if (full) throw new Error("QuotaExceededError"); m.set(k, v); },
    };
    const one = new EventQueue(storage);
    const two = new EventQueue(storage);
    one.add("p", [event("a", "x")]);
    full = false;
    two.add("p", [event("b", "y")]);
    one.markSynced([]); // any later write from tab one
    one.add("p", [event("c", "x")]);
    const ids = new EventQueue(storage).all("p", "x").map((e) => e.eventId).concat(new EventQueue(storage).all("p", "y").map((e) => e.eventId));
    expect(ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("treats the memory stand-in as not saved", () => {
    const q = new EventQueue(browserStorage(() => { throw new Error("SecurityError"); }));
    q.add("p", [event("a", "x")]);
    expect(q.notSaved).toBe(true);
    expect(q.all("p", "x")).toHaveLength(1);
  });
});
