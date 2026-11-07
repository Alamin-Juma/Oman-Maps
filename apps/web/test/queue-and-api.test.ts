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
  it("stores events per pack, ignores duplicates, and tracks what is synced", () => {
    const q = new EventQueue(memory());
    q.add("pack-a", [ev("1"), ev("2")]);
    q.add("pack-a", [ev("2")]);
    q.add("pack-b", [ev("3")]);
    expect(q.all("pack-a").map((e) => e.eventId)).toEqual(["1", "2"]);
    q.markSynced(["1"]);
    expect(q.unsynced("pack-a").map((e) => e.eventId)).toEqual(["2"]);
    expect(q.all("pack-a")).toHaveLength(2);
  });

  it("re-attributes only unsynced events to the server profile", () => {
    const q = new EventQueue(memory());
    q.add("p", [ev("1"), ev("2")]);
    q.markSynced(["1"]);
    q.reassignProfile("server-id");
    expect(q.all("p").map((e) => e.profileId)).toEqual(["local", "server-id"]);
  });

  it("survives corrupt storage", () => {
    const s = memory();
    s.setItem("dunialab.events.v1", "{not json");
    expect(new EventQueue(s).all("p")).toEqual([]);
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

  it("raises ApiError with status and server message", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ message: "parental consent is required" }), { status: 403 });
    const api = new DuniaApi("http://api", () => null, fetchImpl as unknown as typeof fetch);
    await expect(api.addProfile("A", 5, ["lion", "sun", "drum"])).rejects.toMatchObject({ status: 403, message: "parental consent is required" });
    await expect(api.addProfile("A", 5, ["lion", "sun", "drum"])).rejects.toBeInstanceOf(ApiError);
  });
});
