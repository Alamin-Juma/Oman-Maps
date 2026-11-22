/**
 * Product definition:
 *   "Several child profiles live on the parent's phone, each opened with a simple picture PIN."
 * Review finding (PR #1, security): the device queue re-attributed EVERY unsynced event to
 * whichever child was selected, so one sibling's progress could be uploaded as another's.
 * Rule now: an event's owner never changes once it belongs to a child. Only unowned guest
 * events (played before a parent linked the device) can be adopted, once.
 */
import { expect } from "vitest";
import type { AttemptEvent } from "@dunialab/mastery";
import { EventQueue, type KeyValueStorage } from "../../../apps/web/src/lib/queue.js";
import { readGuestId, rotateGuestId } from "../../../apps/web/src/lib/guest.js";
import { feature, scenario } from "../support/gherkin.js";

const PACK = "ke.g5.sst.kenya-explorer";
const memory = (): KeyValueStorage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
/** A phone whose browser storage is full or blocked: every read and write throws. */
const blocked = (): KeyValueStorage => ({
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
});
let n = 0;
const play = (profileId: string): AttemptEvent => ({
  eventId: `e-${++n}`,
  profileId,
  skillId: "map.elements",
  taskId: "m1-t1-title",
  kind: "choice",
  correct: true,
  occurredAt: "2027-01-11T06:00:00Z",
  context: "mission",
});

feature("Siblings sharing one phone keep their own progress", () => {
  scenario("selecting the second child does not move the first child's unsynced events", async ({ given, when, then, and }) => {
    const q = new EventQueue(memory());
    await given("Amani and Baraka each played offline on their mother's phone", () => {
      q.add(PACK, [play("amani"), play("amani")]);
      q.add(PACK, [play("baraka")]);
    });
    let barakaBatch: AttemptEvent[] = [];
    await when("their mother selects Baraka and syncs", () => {
      barakaBatch = q.unsynced(PACK, "baraka");
      q.markSynced(barakaBatch.map((e) => e.eventId));
    });
    await then("only Baraka's event is sent", () => expect(barakaBatch.map((e) => e.profileId)).toEqual(["baraka"]));
    await and("Amani's two events are still hers and still waiting to sync", () => {
      expect(q.unsynced(PACK, "amani")).toHaveLength(2);
      expect(q.all(PACK, "baraka")).toHaveLength(1);
    });
  });

  scenario("guest play before sign-in is adopted by the first child it is linked to, once", async ({ given, when, then, and }) => {
    const q = new EventQueue(memory());
    await given("a child played as a guest before any parent signed in", () => q.add(PACK, [play("guest-1"), play("guest-1")]));
    let adopted = 0;
    await when("the parent links the phone to Amani", () => {
      adopted = q.adoptGuestEvents("guest-1", "amani");
    });
    await then("the guest events now belong to Amani", () => {
      expect(adopted).toBe(2);
      expect(q.unsynced(PACK, "amani")).toHaveLength(2);
    });
    await and("linking to Baraka later cannot take them away", () => {
      expect(q.adoptGuestEvents("guest-1", "baraka")).toBe(0);
      expect(q.unsynced(PACK, "baraka")).toHaveLength(0);
    });
  });

  scenario("after sign-out, a new family cannot adopt the previous family's guest play (findings register CR48)", async ({ given, when, then, and }) => {
    // The real guest-id lifecycle on one storage, not literal ids.
    const storage = memory();
    const q = new EventQueue(storage);
    let oldGuest = "";
    let newGuest = "";
    await given("the previous family's child played as a guest on this phone", () => {
      oldGuest = readGuestId(storage);
      q.add(PACK, [play(oldGuest)]);
    });
    await when("the parent signs out and the app reopens for the next family, whose child also plays", () => {
      rotateGuestId(storage);
      newGuest = readGuestId(storage); // what a reload reads back
      q.add(PACK, [play(newGuest)]);
    });
    await then("the next family's guest id is new, and linking adopts only their own play", () => {
      expect(newGuest).not.toBe(oldGuest);
      expect(q.adoptGuestEvents(newGuest, "wanjiru")).toBe(1);
      expect(q.unsynced(PACK, "wanjiru").map((e) => e.profileId)).toEqual(["wanjiru"]);
    });
    await and("the previous family's play keeps its owner", () => {
      expect(q.unsynced(PACK, oldGuest)).toHaveLength(1);
    });
  });

  scenario("when the new guest id cannot be saved, a reload still never brings back the old one (findings register CR8)", async ({ given, when, then }) => {
    // A full phone: writes fail, but reads and removals work (the usual quota case).
    const m = new Map<string, string>();
    let full = false;
    const storage: KeyValueStorage = {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => {
        if (full) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        m.set(k, v);
      },
      removeItem: (k) => void m.delete(k),
    };
    let oldGuest = "";
    let afterReload = "";
    await given("the previous family's guest id was saved, and then the phone filled up", () => {
      oldGuest = readGuestId(storage);
      full = true;
    });
    await when("the parent signs out and the page is reloaded", () => {
      rotateGuestId(storage);
      afterReload = readGuestId(storage);
    });
    await then("the guest id after the reload is not the previous family's", () => expect(afterReload).not.toBe(oldGuest));
  });

  scenario("sign-out still issues a new guest id when the phone's storage is full or blocked", async ({ given, when, then }) => {
    const storage = blocked();
    let first = "";
    await given("the app opens on a phone whose storage refuses writes", () => {
      first = readGuestId(storage);
    });
    let next = "";
    await when("the parent signs out", () => {
      next = rotateGuestId(storage);
    });
    await then("the app still runs with a fresh guest id, so the next family cannot adopt this play", () => {
      expect(first).toMatch(/^[0-9a-f-]{36}$/);
      expect(next).not.toBe(first);
    });
  });
});
