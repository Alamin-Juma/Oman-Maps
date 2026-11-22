/**
 * Counts attempts per key inside a sliding time window (findings register S9).
 *
 * Used for sign-in, sign-up and online explanation checks. Memory is kept bounded: a full sweep
 * runs when many keys exist, and each key is kept only while its own window can still count it.
 *
 * In memory, so it holds per API process. Running several API instances needs a shared store
 * (deferred in the findings register; the pilot runs one instance).
 */
export interface LimitRule {
  max: number;
  windowMs: number;
}

const SWEEP_AT_KEYS = 10_000;

interface Entry {
  /** The longest window this key was recorded under: the sweep keeps the key while it may still count. */
  windowMs: number;
  times: number[];
}

export class AttemptLimiter {
  private readonly hits = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Seconds until another attempt is allowed under `rule`; 0 when allowed now. */
  retryAfterSeconds(key: string, rule: LimitRule): number {
    const recent = this.recent(key, rule);
    if (recent.length < rule.max) return 0;
    const oldest = recent[recent.length - rule.max]!;
    return Math.max(1, Math.ceil((oldest + rule.windowMs - this.now()) / 1000));
  }

  record(key: string, rule: LimitRule): void {
    const entry = this.hits.get(key);
    const windowMs = Math.max(rule.windowMs, entry?.windowMs ?? 0);
    const since = this.now() - windowMs;
    const times = (entry?.times ?? []).filter((t) => t > since);
    times.push(this.now());
    this.hits.set(key, { windowMs, times });
    if (this.hits.size > SWEEP_AT_KEYS) this.sweep();
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  /** Number of keys held (for tests of the memory bound). */
  get size(): number {
    return this.hits.size;
  }

  /** Attempts of `key` inside `rule`'s window (read-only: history for longer windows is kept). */
  private recent(key: string, rule: LimitRule): number[] {
    const since = this.now() - rule.windowMs;
    return (this.hits.get(key)?.times ?? []).filter((t) => t > since);
  }

  /**
   * Drop keys whose every attempt is outside THAT key's own window. Using the window of whichever
   * rule triggered the sweep would drop a 60-minute sign-up history during a 15-minute sign-in
   * sweep (findings register CR18).
   */
  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.hits) if (entry.times.every((t) => t <= now - entry.windowMs)) this.hits.delete(key);
  }
}
