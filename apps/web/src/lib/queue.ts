/**
 * Offline-first event queue (Tier C). Mirrors what the Unity app does on the phone:
 * every AttemptEvent is written locally first; sync later sends the unsynced ones.
 * Synced events are kept so progress still shows offline.
 *
 * Ownership (shared family phone, PR #1 review): an event's profileId never changes once
 * it belongs to a child. Only GUEST events (played before a parent linked the device, under
 * the current session's guest id) can be adopted, once, by the first child they are linked to.
 */
import type { AttemptEvent } from "@dunialab/mastery";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

interface Stored {
  event: AttemptEvent;
  packId: string;
  synced: boolean;
}

const KEY = "dunialab.events.v1";

export class EventQueue {
  constructor(private readonly storage: KeyValueStorage) {}

  private read(): Stored[] {
    try {
      return JSON.parse(this.storage.getItem(KEY) ?? "[]") as Stored[];
    } catch {
      return [];
    }
  }

  private write(items: Stored[]) {
    try {
      this.storage.setItem(KEY, JSON.stringify(items));
    } catch {
      // Storage full or blocked: the session still works; events are lost only for this tab.
    }
  }

  add(packId: string, events: AttemptEvent[]) {
    const items = this.read();
    const known = new Set(items.map((i) => i.event.eventId));
    for (const event of events) if (!known.has(event.eventId)) items.push({ event, packId, synced: false });
    this.write(items);
  }

  /** All events of one learner for a pack (synced or not): used to show progress offline. */
  all(packId: string, profileId: string): AttemptEvent[] {
    return this.read()
      .filter((i) => i.packId === packId && i.event.profileId === profileId)
      .map((i) => i.event);
  }

  /** Events of one learner still waiting to sync. Never another child's. */
  unsynced(packId: string, profileId: string): AttemptEvent[] {
    return this.read()
      .filter((i) => i.packId === packId && !i.synced && i.event.profileId === profileId)
      .map((i) => i.event);
  }

  markSynced(eventIds: string[]) {
    const ids = new Set(eventIds);
    this.write(this.read().map((i) => (ids.has(i.event.eventId) ? { ...i, synced: true } : i)));
  }

  /**
   * Give unsynced guest events (recorded under `guestId`) to a child profile.
   * Events that already belong to a child are never touched.
   * @returns how many events were adopted.
   */
  adoptGuestEvents(guestId: string, profileId: string): number {
    let adopted = 0;
    this.write(
      this.read().map((i) => {
        if (i.synced || i.event.profileId !== guestId) return i;
        adopted++;
        return { ...i, event: { ...i.event, profileId } };
      }),
    );
    return adopted;
  }
}

/**
 * Wrap storage so it never throws. Browsers throw on access when storage is blocked
 * (private mode, site data disabled) and on writes when the quota is full. A failed read
 * returns null and a failed write is skipped; the app keeps running on in-memory state.
 */
export function safeStorage(inner: KeyValueStorage): Required<KeyValueStorage> {
  return {
    getItem: (k) => {
      try {
        return inner.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        inner.setItem(k, v);
      } catch {
        /* blocked or full: skip the write */
      }
    },
    removeItem: (k) => {
      try {
        inner.removeItem?.(k);
      } catch {
        /* blocked: skip */
      }
    },
  };
}

export function browserStorage(): Required<KeyValueStorage> {
  try {
    return safeStorage(window.localStorage);
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  }
}
