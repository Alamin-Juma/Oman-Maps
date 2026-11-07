import { describe, expect, it, vi } from "vitest";
import type { AttemptEvent } from "@dunialab/mastery";
import { EventQueue, type KeyValueStorage } from "../src/lib/queue.js";
import { ApiError, DuniaApi } from "../src/lib/api.js";

const memory = (): KeyValueStorage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const ev = (id: string, profileId = "local"): AttemptEvent => ({
  eventId: id, profileId, skillId: "s", taskId: "t", kind: "choice", correct: true, occurredAt: "2027-01-11T06:00:00Z", context: "mission",
});

describe("EventQueue", () => {
  it("stores events per pack and learner, ignores duplicates, and tracks what is synced", () => {
    const q = new EventQueue(memory());
    q.add("pack-a", [ev("1"), ev("2")]);
    q.add("pack-a", [ev("2")]);
    q.add("pack-b", [ev("3")]);
    expect(q.all("pack-a", "local").map((e) => e.eventId)).toEqual(["1", "2"]);
    q.markSynced(["1"]);
    expect(q.unsynced("pack-a", "local").map((e) => e.eventId)).toEqual(["2"]);
    expect(q.all("pack-a", "local")).toHaveLength(2);
  });

  it("adopts only unsynced guest events and never touches a child's events", () => {
    const q = new EventQueue(memory());
    q.add("p", [ev("1", "guest"), ev("2", "guest"), ev("3", "amani")]);
    q.markSynced(["1"]);
    expect(q.adoptGuestEvents("guest", "baraka")).toBe(1);
    expect(q.all("p", "baraka").map((e) => e.eventId)).toEqual(["2"]);
    expect(q.all("p", "amani").map((e) => e.eventId)).toEqual(["3"]);
    expect(q.all("p", "guest").map((e) => e.eventId)).toEqual(["1"]); // already synced, untouched
  });

  it("survives corrupt storage", () => {
    const s = memory();
    s.setItem("dunialab.events.v1", "{not json");
    expect(new EventQueue(s).all("p", "local")).toEqual([]);
  });
});

describe("DuniaApi", () => {
  it("sends the bearer token and JSON body", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ accepted: 1, duplicates: 0, skills: [] }), { status: 200 }));
    const api = new DuniaApi("http://api", () => "tok", fetchImpl as unknown as typeof fetch);
    await api.sync("pid", "pack", [ev("1")]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api/v1/sync");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toMatchObject({ profileId: "pid", packId: "pack" });
  });

  it("gives up on a stalled explanation check quickly so the mission can fall back offline", async () => {
    // A fetch that never answers, but honours its AbortSignal like the real one.
    const stalled = ((_: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const api = new DuniaApi("http://api", () => "tok", stalled, 50);
    const started = Date.now();
    const check = api.checkerFor("pack");
    await expect(check({ id: "t" } as never, "answer", "en", 1)).rejects.toBeTruthy();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("raises ApiError with status and server message", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ message: "parental consent is required" }), { status: 403 });
    const api = new DuniaApi("http://api", () => null, fetchImpl as unknown as typeof fetch);
    await expect(api.addProfile("A", 5, ["lion", "sun", "drum"])).rejects.toMatchObject({ status: 403, message: "parental consent is required" });
    await expect(api.addProfile("A", 5, ["lion", "sun", "drum"])).rejects.toBeInstanceOf(ApiError);
  });
});
