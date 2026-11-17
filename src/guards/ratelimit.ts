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
 * everybody. The table must stay bounded: when it is full the OLDEST client is forgotten to make room (that client gets
 * a fresh budget; the global DailyCap still bounds the spend). It used to refuse every new client instead, which let
 * anyone with enough addresses lock everybody else out for the rest of the day.
 */
export class KeyedDailyCap {
  private day = "";
  private counts = new Map<string, number>();
  private readonly cap: number;
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(cap: number, now: () => number = Date.now, maxKeys = 50_000) {
    this.cap = cap;
    this.now = now;
    this.maxKeys = maxKeys;
  }

  allow(key: string): boolean {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.counts.clear();
    }
    const n = this.counts.get(key);
    if (n === undefined && this.counts.size >= this.maxKeys) {
      const oldest = this.counts.keys().next().value;
      if (oldest !== undefined) this.counts.delete(oldest);
    }
    if ((n ?? 0) >= this.cap) return false;
    this.counts.set(key, (n ?? 0) + 1);
    return true;
  }
}
