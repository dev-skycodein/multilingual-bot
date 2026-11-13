// In-memory limits. Fine for one server process; a multi-instance deployment
// would need a shared store (e.g. Redis).

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Returns true if the request is allowed (and records it). */
  allow(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(t);
    return true;
  }

  private prune(t: number): void {
    for (const [key, list] of this.hits) {
      if (list.every((x) => t - x >= this.windowMs)) this.hits.delete(key);
    }
  }
}

/** Caps total requests per UTC day, to bound spend. */
export class DailyCap {
  private day = "";
  private count = 0;
  private readonly cap: number;
  private readonly now: () => number;

  constructor(cap: number, now: () => number = Date.now) {
    this.cap = cap;
    this.now = now;
  }

  allow(): boolean {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
    if (this.count >= this.cap) return false;
    this.count++;
    return true;
  }
}

/**
 * Caps requests per client per UTC day. It stops one client from using up the global DailyCap for
 * everybody. If more than MAX_KEYS different clients show up in one day, new clients are refused
 * (the table must stay bounded).
 */
export class KeyedDailyCap {
  private static readonly MAX_KEYS = 50_000;
  private day = "";
  private counts = new Map<string, number>();
  private readonly cap: number;
  private readonly now: () => number;

  constructor(cap: number, now: () => number = Date.now) {
    this.cap = cap;
    this.now = now;
  }

  allow(key: string): boolean {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.counts.clear();
    }
    const n = this.counts.get(key);
    if (n === undefined && this.counts.size >= KeyedDailyCap.MAX_KEYS) return false;
    if ((n ?? 0) >= this.cap) return false;
    this.counts.set(key, (n ?? 0) + 1);
    return true;
  }
}
