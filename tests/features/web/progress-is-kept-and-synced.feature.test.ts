/**
 * Product definition: "Progress is recorded offline first. Events queue on the device and sync when
 * a connection appears." Offline use on a shared, inexpensive phone is the product's normal case.
 *
 * Findings register:
 *   R1 - when the phone's storage refused a write, the event vanished and nobody was told;
 *   R2 - stored data of the wrong shape crashed the progress panel;
 *   R4 - more than 500 waiting events could never sync (the server accepts 500 per request).
 */
import { expect } from "vitest";
import { SYNC_MAX_EVENTS, type AttemptEvent } from "@dunialab/mastery";
import { browserStorage, EventQueue, type KeyValueStorage } from "../../../apps/web/src/lib/queue.js";
import { syncInBatches, type SyncClient, type SyncOutcome } from "../../../apps/web/src/lib/sync.js";
import { DuniaApi } from "../../../apps/web/src/lib/api.js";
import { feature, scenario } from "../support/gherkin.js";

const PACK = "ke.g5.sst.kenya-explorer";
let n = 0;
const play = (profileId = "amani"): AttemptEvent => ({
  eventId: `e-${++n}`,
  profileId,
  skillId: "map.elements",
  taskId: "m1-t1-title",
  kind: "choice",
  correct: true,
  occurredAt: "2027-01-11T06:00:00Z",
  context: "mission",
});

/** A phone's storage that can be switched to refuse writes, like a full phone or private browsing. */
function phoneStorage() {
  const data = new Map<string, string>();
  let full = false;
  const storage: KeyValueStorage & { fill(on: boolean): void; raw: Map<string, string> } = {
    raw: data,
    fill: (on) => (full = on),
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (full) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      data.set(k, v);
    },
  };
  return storage;
}

/** A server that accepts at most SYNC_MAX_EVENTS per request, and can drop the connection. */
function server(failOnRequest?: number) {
  const received: string[][] = [];
  let requests = 0;
  const client: SyncClient = {
    async sync(_profileId, _packId, events) {
      requests++;
      if (requests === failOnRequest) throw new Error("Network error: connection dropped");
      if (events.length > SYNC_MAX_EVENTS) throw new Error(`400: at most ${SYNC_MAX_EVENTS} events per request`);
      received.push(events.map((e) => e.eventId));
      return { accepted: events.length, duplicates: 0 };
    },
  };
  return { client, received, requests: () => requests };
}

feature("A child's progress is never lost silently, and every waiting event can sync", () => {
  scenario("when the phone's storage is full, progress stays for this session and the app says it is not saved", async ({ given, when, then, and }) => {
    const storage = phoneStorage();
    const queue = new EventQueue(storage);
    await given("a phone whose storage is full", () => storage.fill(true));
    await when("Amani finishes two tasks", () => queue.add(PACK, [play(), play()]));
    await then("both events are still there for this session, so progress shows and can still sync", () => {
      expect(queue.all(PACK, "amani")).toHaveLength(2);
      expect(queue.unsynced(PACK, "amani")).toHaveLength(2);
    });
    await and("the app is told they are not saved on this phone", () => expect(queue.notSaved).toBe(true));
  });

  scenario("once storage works again, everything waiting is saved and the warning clears", async ({ given, when, then }) => {
    const storage = phoneStorage();
    const queue = new EventQueue(storage);
    await given("two events kept only in memory while storage was full", () => {
      storage.fill(true);
      queue.add(PACK, [play(), play()]);
    });
    await when("space is freed and Amani finishes another task", () => {
      storage.fill(false);
      queue.add(PACK, [play()]);
    });
    await then("all three are saved on the phone and the warning is gone", () => {
      expect(queue.notSaved).toBe(false);
      expect(new EventQueue(storage).all(PACK, "amani")).toHaveLength(3);
    });
  });

  scenario("damaged saved data does not crash the app; good events are kept and the damage is set aside", async ({ given, when, then, and }) => {
    const storage = phoneStorage();
    const good = play();
    let queue = new EventQueue(storage);
    await given("saved progress where one entry is damaged", () => {
      storage.raw.set("dunialab.events.v1", JSON.stringify([{ event: good, packId: PACK, synced: false }, { nonsense: true }]));
    });
    await when("the app reads the progress", () => {
      queue = new EventQueue(storage);
    });
    await then("the good event is still there", () => expect(queue.all(PACK, "amani").map((e) => e.eventId)).toEqual([good.eventId]));
    await and("the damaged copy is kept aside, not thrown away, and the app is told", () => {
      expect(queue.recoveredDamaged).toBe(1);
      expect(storage.raw.get("dunialab.events.v1.damaged")).toContain("nonsense");
    });
  });

  scenario("saved data that is not a list at all is handled the same way", async ({ given, when, then }) => {
    const storage = phoneStorage();
    let read: () => unknown = () => null;
    await given("saved progress that is valid JSON but the wrong shape", () => storage.raw.set("dunialab.events.v1", "{}"));
    await when("the app reads the progress", () => {
      const queue = new EventQueue(storage);
      read = () => queue.all(PACK, "amani");
    });
    await then("it gets an empty list instead of crashing, and the original is set aside", () => {
      expect(read()).toEqual([]);
      expect(storage.raw.get("dunialab.events.v1.damaged")).toBe("{}");
    });
  });

  scenario("1,200 waiting events sync in batches the server accepts", async ({ given, when, then, and }) => {
    const queue = new EventQueue(phoneStorage());
    const srv = server();
    await given("a child who played offline for weeks: 1,200 events waiting", () => {
      queue.add(PACK, Array.from({ length: 1200 }, () => play()));
    });
    let outcome: Awaited<ReturnType<typeof syncInBatches>> | undefined;
    await when("the parent syncs", async () => {
      outcome = await syncInBatches(queue, srv.client, PACK, "amani");
    });
    await then("every request is within the server's limit", () => {
      expect(srv.received.every((batch) => batch.length <= SYNC_MAX_EVENTS)).toBe(true);
      expect(srv.received.length).toBe(Math.ceil(1200 / SYNC_MAX_EVENTS));
    });
    await and("all 1,200 reached the server once and nothing is left waiting", () => {
      expect(new Set(srv.received.flat()).size).toBe(1200);
      expect(outcome).toMatchObject({ sent: 1200, accepted: 1200, remaining: 0 });
      expect(queue.unsynced(PACK, "amani")).toEqual([]);
    });
  });

  scenario("if the connection drops part-way, what was sent stays sent and the rest waits for the next try", async ({ given, when, then, and }) => {
    const queue = new EventQueue(phoneStorage());
    const flaky = server(2);
    await given("1,200 events waiting", () => queue.add(PACK, Array.from({ length: 1200 }, () => play())));
    let outcome: SyncOutcome = { sent: 0, accepted: 0, duplicates: 0, remaining: 0 };
    await when("the connection drops during the second batch", async () => {
      outcome = await syncInBatches(queue, flaky.client, PACK, "amani");
    });
    await then("the first batch is marked sent and the rest is still waiting", () => {
      expect(outcome.sent).toBe(SYNC_MAX_EVENTS);
      expect(outcome.remaining).toBe(1200 - SYNC_MAX_EVENTS);
      expect(outcome.error).toBeInstanceOf(Error);
      expect(queue.unsynced(PACK, "amani")).toHaveLength(1200 - SYNC_MAX_EVENTS);
    });
    await and("the next try sends only what is left", async () => {
      const healthy = server();
      const retry = await syncInBatches(queue, healthy.client, PACK, "amani");
      expect(retry.sent).toBe(1200 - SYNC_MAX_EVENTS);
      expect(retry.remaining).toBe(0);
    });
  });

  // Findings register R3: two tabs (or the app open twice) shared one saved list with
  // read-modify-write and no merging, so one tab's save could wipe the other's new event.
  scenario("two tabs saving at the same moment keep both children's answers", async ({ given, when, then }) => {
    const storage = phoneStorage();
    const tabOne = new EventQueue(storage);
    const tabTwo = new EventQueue(storage);
    const fromTabOne = play("amani");
    const fromTabTwo = play("baraka");
    await given("tab two saves an answer exactly while tab one is in the middle of saving", () => {
      const realGet = storage.getItem;
      let interleaved = false;
      storage.getItem = (k) => {
        const snapshot = realGet(k);
        if (!interleaved) {
          interleaved = true;
          tabTwo.add(PACK, [fromTabTwo]); // lands between tab one's read and its write
        }
        return snapshot;
      };
    });
    await when("tab one finishes saving its own answer", () => tabOne.add(PACK, [fromTabOne]));
    await then("both answers are on the phone", () => {
      const onPhone = new EventQueue(storage);
      expect(onPhone.all(PACK, "amani").map((e) => e.eventId)).toEqual([fromTabOne.eventId]);
      expect(onPhone.all(PACK, "baraka").map((e) => e.eventId)).toEqual([fromTabTwo.eventId]);
    });
  });

  scenario("a sync finishing in one tab does not undo answers added in another", async ({ given, when, then, and }) => {
    const storage = phoneStorage();
    const syncingTab = new EventQueue(storage);
    const playingTab = new EventQueue(storage);
    const early = play();
    const late = play();
    await given("an answer waiting to sync", () => syncingTab.add(PACK, [early]));
    await when("the other tab saves a new answer, then the first tab marks the early one synced", () => {
      playingTab.add(PACK, [late]);
      syncingTab.markSynced([early.eventId]);
    });
    await then("the new answer is still there and still waiting", () => {
      expect(new EventQueue(storage).unsynced(PACK, "amani").map((e) => e.eventId)).toEqual([late.eventId]);
    });
    await and("the early answer is marked synced", () => {
      expect(new EventQueue(storage).all(PACK, "amani")).toHaveLength(2);
    });
  });

  scenario("the client and the server agree on the limit", async ({ then }) => {
    await then("the shared limit is the server's per-request maximum", () => expect(SYNC_MAX_EVENTS).toBe(500));
  });

  scenario("a tab whose save failed does not overwrite another tab's answers when it can save again (findings register CR20)", async ({ given, when, then }) => {
    const storage = phoneStorage();
    const tabOne = new EventQueue(storage);
    const tabTwo = new EventQueue(storage);
    const [a, b, c] = [play("amani"), play("baraka"), play("amani")];
    await given("tab one could not save Amani's answer because the phone was full", () => {
      storage.fill(true);
      tabOne.add(PACK, [a]);
      expect(tabOne.notSaved).toBe(true);
    });
    await when("space is freed, tab two saves Baraka's answer, then tab one saves another answer", () => {
      storage.fill(false);
      tabTwo.add(PACK, [b]);
      tabOne.add(PACK, [c]);
    });
    await then("all three answers are on the phone", () => {
      const fresh = new EventQueue(storage);
      expect(fresh.all(PACK, "amani").map((e) => e.eventId).sort()).toEqual([a.eventId, c.eventId].sort());
      expect(fresh.all(PACK, "baraka").map((e) => e.eventId)).toEqual([b.eventId]);
      expect(tabOne.notSaved).toBe(false);
    });
  });

  scenario("when the browser gives no storage at all, the app says progress is not saved (findings register CR21)", async ({ given, when, then, and }) => {
    let q = new EventQueue(browserStorage(() => ({ getItem: () => null, setItem: () => true })));
    await given("a browser where opening storage itself throws (site data blocked)", () => {
      q = new EventQueue(browserStorage(() => { throw new DOMException("The operation is insecure.", "SecurityError"); }));
    });
    await when("the child answers a question", () => q.add(PACK, [play("amani")]));
    await then("the answer is kept for this session", () => expect(q.all(PACK, "amani")).toHaveLength(1));
    await and("the app knows it is not saved on the phone, so the warning shows", () => expect(q.notSaved).toBe(true));
  });

  scenario("positive control: real storage saves, and no warning shows", async ({ when, then }) => {
    const m = new Map<string, string>();
    const q = new EventQueue(browserStorage(() => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) })));
    await when("the child answers a question", () => q.add(PACK, [play("amani")]));
    await then("it is saved and the warning stays hidden", () => {
      expect(q.notSaved).toBe(false);
      expect(m.size).toBe(1);
    });
  });

  scenario("an empty 'OK' from a proxy is not a sync: the answers stay waiting (findings register CR92)", async ({ given, when, then, and }) => {
    const q = new EventQueue(phoneStorage());
    let outcome: SyncOutcome | undefined;
    await given("two answers waiting, and a proxy that answers the sync with an empty 200", () => {
      q.add(PACK, [play("amani"), play("amani")]);
    });
    await when("the parent presses Sync now", async () => {
      const emptyOk = (async () => new Response("", { status: 200 })) as typeof fetch;
      outcome = await syncInBatches(q, new DuniaApi("http://api.test", () => "token", emptyOk), PACK, "amani");
    });
    await then("nothing is marked as synced", () => expect(q.unsynced(PACK, "amani")).toHaveLength(2));
    await and("the parent is told it failed", () => {
      expect(outcome!.error).toBeDefined();
      expect(outcome!.sent).toBe(0);
    });
  });

  scenario("an acknowledgement of the wrong shape is not a sync either", async ({ then }) => {
    await then("the answers stay waiting", async () => {
      const q = new EventQueue(phoneStorage());
      q.add(PACK, [play("amani")]);
      const odd: SyncClient = { sync: async () => ({ ok: true }) as unknown as { accepted: number; duplicates: number } };
      const outcome = await syncInBatches(q, odd, PACK, "amani");
      expect(q.unsynced(PACK, "amani")).toHaveLength(1);
      expect(outcome.error).toBeDefined();
    });
  });
});

