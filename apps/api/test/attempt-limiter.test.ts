import { describe, expect, it } from "vitest";
import { AttemptLimiter } from "../src/auth/attempt-limiter.js";
import { DEFAULT_RATE_LIMITS, loadConfig } from "../src/config.js";

const rule = { max: 3, windowMs: 60_000 };

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("AttemptLimiter", () => {
  it("allows attempts below the limit and refuses at it", () => {
    const c = clock();
    const l = new AttemptLimiter(c.now);
    for (let i = 0; i < rule.max; i++) {
      expect(l.retryAfterSeconds("k", rule)).toBe(0);
      l.record("k", rule);
    }
    expect(l.retryAfterSeconds("k", rule)).toBeGreaterThan(0);
  });

  it("says how long to wait: until the oldest counted attempt leaves the window", () => {
    const c = clock();
    const l = new AttemptLimiter(c.now);
    l.record("k", rule);
    c.advance(10_000);
    l.record("k", rule);
    l.record("k", rule);
    expect(l.retryAfterSeconds("k", rule)).toBe(50); // the first attempt expires 50 s from now
    c.advance(50_000);
    expect(l.retryAfterSeconds("k", rule)).toBe(0);
  });

  it("never asks to wait less than a second while refusing", () => {
    const c = clock();
    const l = new AttemptLimiter(c.now);
    for (let i = 0; i < rule.max; i++) l.record("k", rule);
    c.advance(rule.windowMs - 1);
    expect(l.retryAfterSeconds("k", rule)).toBe(1);
  });

  it("keeps keys apart, and clearing one does not touch another", () => {
    const l = new AttemptLimiter(clock().now);
    for (let i = 0; i < rule.max; i++) {
      l.record("a", rule);
      l.record("b", rule);
    }
    l.clear("a");
    expect(l.retryAfterSeconds("a", rule)).toBe(0);
    expect(l.retryAfterSeconds("b", rule)).toBeGreaterThan(0);
  });

  it("forgets expired keys, so memory does not grow without bound", () => {
    const c = clock();
    const l = new AttemptLimiter(c.now);
    for (let i = 0; i < 10_001; i++) l.record(`k${i}`, rule);
    c.advance(rule.windowMs + 1);
    l.record("fresh", rule); // over the sweep threshold: expired keys are dropped
    expect(l.size).toBe(1);
  });

  it("a sweep started by a short rule keeps a long rule's live history (findings register CR18)", () => {
    const c = clock();
    const l = new AttemptLimiter(c.now);
    const hour = { max: 1, windowMs: 60 * 60_000 };
    const quarter = { max: 30, windowMs: 15 * 60_000 };
    l.record("register:1.2.3.4", hour); // one sign-up: this address is at its hourly limit
    for (let i = 0; i < 10_001; i++) l.record(`login:${i}`, quarter);
    c.advance(20 * 60_000); // past the 15-minute window, inside the hour
    l.record("login:trigger", quarter); // the sweep runs with the 15-minute rule
    expect(l.retryAfterSeconds("register:1.2.3.4", hour)).toBeGreaterThan(0);
    expect(l.size).toBe(2); // the expired 15-minute keys are gone
  });
});

describe("rate limit configuration", () => {
  it("uses the production limits by default, with the per-account limit tighter than the per-address one", () => {
    const config = loadConfig({ NODE_ENV: "development" });
    expect(config.rateLimits).toEqual(DEFAULT_RATE_LIMITS);
    expect(DEFAULT_RATE_LIMITS.loginFailuresPerAccount.max).toBeLessThan(DEFAULT_RATE_LIMITS.loginAttemptsPerAddress.max);
  });

  it("reads TRUST_PROXY as a hop count, a boolean or a list", () => {
    expect(loadConfig({ TRUST_PROXY: "1" }).trustProxy).toBe(1);
    expect(loadConfig({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: "loopback, 10.0.0.0/8" }).trustProxy).toBe("loopback, 10.0.0.0/8");
    expect(loadConfig({}).trustProxy).toBeUndefined();
  });
});
