/**
 * Offline play needs an id before any parent links the device: a per-session GUEST id.
 * Guest events are adopted once by the first child the parent links; a new guest id is
 * issued on sign-out so the next family can never adopt this family's guest play.
 *
 * Storage may be blocked or full (PR #1 review). These functions never throw: the id is
 * always returned, and persisting it is best-effort.
 */
import { uuid } from "@dunialab/mission";
import { safeStorage, type KeyValueStorage } from "./queue.js";

export const GUEST_KEY = "dunialab.guestId";

export function readGuestId(storage: KeyValueStorage): string {
  const s = safeStorage(storage);
  const existing = s.getItem(GUEST_KEY);
  if (existing) return existing;
  const id = uuid();
  s.setItem(GUEST_KEY, id);
  return id;
}

/**
 * Issue a new guest id. The caller switches to the returned id even if it could not be saved.
 *
 * If the new id cannot be saved, the old one is removed instead (findings register CR8): otherwise a
 * reload would read the previous family's guest id back, and the next family could adopt its play.
 * On a full phone removal still works; on a blocked one reads fail too, so a reload gets a new id.
 */
export function rotateGuestId(storage: KeyValueStorage): string {
  const s = safeStorage(storage);
  const fresh = uuid();
  if (!s.setItem(GUEST_KEY, fresh)) s.removeItem(GUEST_KEY);
  return fresh;
}
