/**
 * Counts attempts per key inside a sliding time window (findings register S9).
 *
 * Used for sign-in and sign-up only. Keys are "account:<email>" and "address:<ip>". Memory is kept
 * bounded: expired entries are dropped as they are read, and a full sweep runs when many keys exist.
 *
 * In memory, so it holds per API process. Running several API instances needs a shared store
 * (deferred in the findings register; the pilot runs one instance).
 */
export interface LimitRule {
  max: number;
  windowMs: number;
}

const SWEEP_AT_KEYS = 10_000;

export class AttemptLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Seconds until another attempt is allowed under `rule`; 0 when allowed now. */
  retryAfterSeconds(key: string, rule: LimitRule): number {
    const recent = this.recent(key, rule);
    if (recent.length < rule.max) return 0;
    const oldest = recent[recent.length - rule.max]!;
    return Math.max(1, Math.ceil((oldest + rule.windowMs - this.now()) / 1000));
  }

  record(key: string, rule: LimitRule): void {
    const recent = this.recent(key, rule);
    recent.push(this.now());
    this.hits.set(key, recent);
    if (this.hits.size > SWEEP_AT_KEYS) this.sweep(rule.windowMs);
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  /** Number of keys held (for tests of the memory bound). */
  get size(): number {
    return this.hits.size;
  }

  private recent(key: string, rule: LimitRule): number[] {
    const since = this.now() - rule.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (kept.length) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  private sweep(windowMs: number): void {
    const since = this.now() - windowMs;
    for (const [key, times] of this.hits) if (times.every((t) => t <= since)) this.hits.delete(key);
  }
}
