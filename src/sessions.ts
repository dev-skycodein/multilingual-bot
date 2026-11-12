import { randomUUID } from "node:crypto";

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface Session {
  history: Turn[];
  lastSeen: number;
}

const ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Conversation history lives on the server only. The client sends just a
// session id and one message, so it can never inject fake "assistant" or
// "system" turns into the history.
export class SessionStore {
  private sessions = new Map<string, Session>();
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private readonly maxMessages: number;
  private readonly now: () => number;

  constructor(ttlMs: number, maxSessions: number, maxMessages: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.maxSessions = maxSessions;
    this.maxMessages = maxMessages;
    this.now = now;
  }

  /** Returns the id to use: the given one if it exists and is alive, else a new one. */
  open(requestedId: unknown): string {
    this.expire();
    if (typeof requestedId === "string" && ID_FORMAT.test(requestedId)) {
      const existing = this.sessions.get(requestedId);
      if (existing) {
        existing.lastSeen = this.now();
        return requestedId;
      }
    }
    // Unknown ids are never adopted: the server always generates its own.
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    const id = randomUUID();
    this.sessions.set(id, { history: [], lastSeen: this.now() });
    return id;
  }

  history(id: string): Turn[] {
    return [...(this.sessions.get(id)?.history ?? [])];
  }

  /** Appends one completed exchange and trims to the cap (always starting on a user turn). */
  append(id: string, userText: string, assistantText: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.history.push({ role: "user", content: userText }, { role: "assistant", content: assistantText });
    if (s.history.length > this.maxMessages) s.history = s.history.slice(-this.maxMessages);
    while (s.history[0] && s.history[0].role !== "user") s.history.shift();
    s.lastSeen = this.now();
  }

  private expire(): void {
    const t = this.now();
    for (const [id, s] of this.sessions) {
      if (t - s.lastSeen > this.ttlMs) this.sessions.delete(id);
    }
  }
}
