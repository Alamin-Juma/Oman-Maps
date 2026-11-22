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
  /** Throws, or returns `false`, when the write did not happen (full or blocked storage). */
  setItem(key: string, value: string): void | boolean;
  removeItem?(key: string): void;
}

export interface Stored {
  event: AttemptEvent;
  packId: string;
  synced: boolean;
}

const KEY = "dunialab.events.v1";
/** Where damaged saved data is set aside instead of being thrown away (findings register R2). */
const DAMAGED_KEY = `${KEY}.damaged`;

const KINDS = new Set(["choice", "locate", "explain", "follow-up"]);
const CONTEXTS = new Set(["mission", "review"]);

/** True when a value read back from storage is a well-formed queue entry. */
export function isStoredEvent(x: unknown): x is Stored {
  if (typeof x !== "object" || x === null) return false;
  const item = x as Record<string, unknown>;
  const e = item.event as Record<string, unknown> | null | undefined;
  return (
    typeof item.packId === "string" &&
    typeof item.synced === "boolean" &&
    typeof e === "object" &&
    e !== null &&
    typeof e.eventId === "string" &&
    typeof e.profileId === "string" &&
    typeof e.skillId === "string" &&
    typeof e.taskId === "string" &&
    typeof e.kind === "string" &&
    KINDS.has(e.kind) &&
    typeof e.correct === "boolean" &&
    typeof e.occurredAt === "string" &&
    typeof e.context === "string" &&
    CONTEXTS.has(e.context)
  );
}

export class EventQueue {
  /**
   * The whole queue, kept in memory while the phone's storage refuses writes (findings register
   * R1). While set, it is the truth for this session; every later write tries storage again.
   */
  private unsaved: Stored[] | null = null;
  /** Ids changed while saving was failing: the recovery write merges them in (findings register CR20). */
  private pendingTouched = new Set<string>();
  private damaged = 0;

  constructor(private readonly storage: KeyValueStorage) {}

  /** True when progress exists only in memory because the last save to the phone failed. */
  get notSaved(): boolean {
    return this.unsaved !== null;
  }

  /** How many damaged entries were found in saved data and set aside (not deleted). */
  get recoveredDamaged(): number {
    return this.damaged;
  }

  private read(): Stored[] {
    if (this.unsaved) return this.unsaved.slice();
    let raw: string | null;
    try {
      raw = this.storage.getItem(KEY);
    } catch {
      return [];
    }
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.setAside(raw, 1);
      return [];
    }
    if (!Array.isArray(parsed)) {
      this.setAside(raw, 1);
      return [];
    }
    const valid = parsed.filter(isStoredEvent);
    if (valid.length !== parsed.length) {
      this.setAside(raw, parsed.length - valid.length);
      this.write(valid);
    }
    return valid;
  }

  /** Keep a copy of damaged data under another key, so it can be looked at instead of being lost. */
  private setAside(raw: string, entries: number) {
    this.damaged += entries;
    try {
      this.storage.setItem(DAMAGED_KEY, raw);
    } catch {
      /* best effort: the app must keep working even if this copy cannot be kept */
    }
    try {
      this.storage.setItem(KEY, "[]");
    } catch {
      /* the next successful write replaces it anyway */
    }
  }

  /**
   * Save the queue. With `touched` (the ids this operation changed), first re-read what is stored
   * and merge (findings register R3): another tab (or the app open twice) may have saved since we
   * read. Their events are kept, "synced" marks are combined, and our version wins only for the
   * events we touched. The remaining window is the instant between this re-read and the save; the
   * full fix is IndexedDB transactions (deferred in the register).
   */
  private write(items: Stored[], touched?: ReadonlySet<string>) {
    // Every write that changes events merges with what is stored, including the first write after
    // saving failed: another tab may have saved since, and those events must survive (CR20).
    const changed = new Set([...this.pendingTouched, ...(touched ?? [])]);
    const toSave = touched ? mergeQueues(this.peekStored(), items, changed) : items;
    let saved: boolean;
    try {
      saved = this.storage.setItem(KEY, JSON.stringify(toSave)) !== false;
    } catch {
      saved = false;
    }
    // Storage full or blocked: keep everything in memory for this session and say so, rather
    // than letting the child's progress disappear (findings register R1).
    this.unsaved = saved ? null : toSave;
    this.pendingTouched = saved ? new Set() : changed;
  }

  /** What is in storage right now, valid entries only, without side effects. */
  private peekStored(): Stored[] {
    try {
      const parsed: unknown = JSON.parse(this.storage.getItem(KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter(isStoredEvent) : [];
    } catch {
      return [];
    }
  }

  add(packId: string, events: AttemptEvent[]) {
    const items = this.read();
    const known = new Set(items.map((i) => i.event.eventId));
    const added = new Set<string>();
    for (const event of events) {
      if (known.has(event.eventId) || added.has(event.eventId)) continue;
      items.push({ event, packId, synced: false });
      added.add(event.eventId);
    }
    this.write(items, added);
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
    this.write(
      this.read().map((i) => (ids.has(i.event.eventId) ? { ...i, synced: true } : i)),
      ids,
    );
  }

  /**
   * Give unsynced guest events (recorded under `guestId`) to a child profile.
   * Events that already belong to a child are never touched.
   * @returns how many events were adopted.
   */
  adoptGuestEvents(guestId: string, profileId: string): number {
    const adopted = new Set<string>();
    this.write(
      this.read().map((i) => {
        if (i.synced || i.event.profileId !== guestId) return i;
        adopted.add(i.event.eventId);
        return { ...i, event: { ...i.event, profileId } };
      }),
      adopted,
    );
    return adopted.size;
  }
}

/**
 * Combine what is stored (`theirs`) with this tab's view (`ours`). Every event from either side is
 * kept, in stored order, then new ones. For an event both sides have, `ours` wins only if this
 * operation touched it; otherwise theirs is kept, with "synced" true if either side says so.
 */
export function mergeQueues(theirs: readonly Stored[], ours: readonly Stored[], touched: ReadonlySet<string>): Stored[] {
  const byId = new Map(theirs.map((t) => [t.event.eventId, t] as const));
  const appended: Stored[] = [];
  for (const o of ours) {
    const t = byId.get(o.event.eventId);
    if (!t) appended.push(o);
    else if (touched.has(o.event.eventId)) byId.set(o.event.eventId, o);
    else if (o.synced && !t.synced) byId.set(o.event.eventId, { ...t, synced: true });
  }
  return [...byId.values(), ...appended];
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
        return inner.setItem(k, v) !== false;
      } catch {
        return false; // blocked or full: the write did not happen, and callers that care can tell
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

/**
 * The phone's storage, or a memory stand-in when the browser gives none (site data blocked).
 * The stand-in keeps data for this page only, so its writes report `false`: the queue then knows
 * progress is NOT saved on the phone and the app says so (findings register CR21).
 */
export function browserStorage(open: () => KeyValueStorage = () => window.localStorage): Required<KeyValueStorage> {
  try {
    return safeStorage(open());
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => {
        mem.set(k, v);
        return false; // kept in memory only: not durable
      },
      removeItem: (k) => void mem.delete(k),
    };
  }
}
