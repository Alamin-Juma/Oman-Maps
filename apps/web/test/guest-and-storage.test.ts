import { describe, expect, it } from "vitest";
import { GUEST_KEY, readGuestId, rotateGuestId } from "../src/lib/guest.js";
import { safeStorage, type KeyValueStorage } from "../src/lib/queue.js";

const memory = (): KeyValueStorage & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
const throwing = (): KeyValueStorage => ({
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError"); },
});

describe("guest id", () => {
  it("is created once and then reused", () => {
    const s = memory();
    const id = readGuestId(s);
    expect(s.m.get(GUEST_KEY)).toBe(id);
    expect(readGuestId(s)).toBe(id);
  });

  it("rotates to a new persisted id", () => {
    const s = memory();
    const old = readGuestId(s);
    const fresh = rotateGuestId(s);
    expect(fresh).not.toBe(old);
    expect(s.m.get(GUEST_KEY)).toBe(fresh);
  });

  it("never throws when storage is blocked; the in-memory id still rotates", () => {
    const s = throwing();
    const a = readGuestId(s);
    const b = rotateGuestId(s);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).not.toBe(a);
  });
});

describe("safeStorage", () => {
  it("passes through to working storage", () => {
    const inner = memory();
    const s = safeStorage(inner);
    s.setItem("k", "v");
    expect(s.getItem("k")).toBe("v");
    s.removeItem("k");
    expect(inner.m.has("k")).toBe(false);
  });

  it("turns storage errors into a no-op write and a null read", () => {
    const s = safeStorage(throwing());
    expect(() => s.setItem("k", "v")).not.toThrow();
    expect(() => s.removeItem("k")).not.toThrow();
    expect(s.getItem("k")).toBeNull();
  });
});
