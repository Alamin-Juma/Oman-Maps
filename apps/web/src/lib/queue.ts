/**
 * Offline-first event queue (Tier C). Mirrors what the Unity app does on the phone:
 * every AttemptEvent is written locally first; sync later sends the unsynced ones.
 * Synced events are kept so progress still shows offline.
 */
import type { AttemptEvent } from "@dunialab/mastery";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
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

  /** All events for a pack (synced or not): used to show progress offline. */
  all(packId: string): AttemptEvent[] {
    return this.read().filter((i) => i.packId === packId).map((i) => i.event);
  }

  unsynced(packId: string): AttemptEvent[] {
    return this.read().filter((i) => i.packId === packId && !i.synced).map((i) => i.event);
  }

  markSynced(eventIds: string[]) {
    const ids = new Set(eventIds);
    this.write(this.read().map((i) => (ids.has(i.event.eventId) ? { ...i, synced: true } : i)));
  }

  /**
   * Events are recorded against a local profile id while offline; when a parent links the
   * device to a server profile, they are re-attributed before the first sync.
   */
  reassignProfile(profileId: string) {
    this.write(this.read().map((i) => (i.synced ? i : { ...i, event: { ...i.event, profileId } })));
  }
}

export function browserStorage(): KeyValueStorage {
  try {
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
  }
}
