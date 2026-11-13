import { loadConfig } from "../src/config.ts";
import { buildSystemPrompt } from "../src/prompt.ts";
import { SessionStore } from "../src/sessions.ts";
import { createOutputGuard } from "../src/guards/output.ts";
import { SlidingWindowLimiter, DailyCap, KeyedDailyCap } from "../src/guards/ratelimit.ts";
import type { ChatDeps } from "../src/chat.ts";
import type { LlmClient, ReplyResult, Verdict } from "../src/llm.ts";
import type { Turn } from "../src/sessions.ts";

export const CANARY = "CANARY-test-0000-1111-2222";

export interface FakeLlm extends LlmClient {
  classifyCalls: string[];
  classifyContexts: (string[] | undefined)[];
  replyCalls: { system: string; history: Turn[] }[];
  verdict: Verdict | Error;
  next: ReplyResult | Error;
  /** Replies handed out first, one per call; when empty `next` is used. */
  queue: ReplyResult[];
}

export function fakeLlm(): FakeLlm {
  const llm: FakeLlm = {
    classifyCalls: [],
    classifyContexts: [],
    replyCalls: [],
    verdict: "SAFE",
    next: { kind: "text", text: "Hello! I can help with OpBritops." },
    queue: [],
    async classify(text, context) {
      llm.classifyCalls.push(text);
      llm.classifyContexts.push(context);
      if (llm.verdict instanceof Error) throw llm.verdict;
      return llm.verdict;
    },
    async reply(system, history) {
      llm.replyCalls.push({ system, history });
      const queued = llm.queue.shift();
      if (queued) return queued;
      if (llm.next instanceof Error) throw llm.next;
      return llm.next;
    },
  };
  return llm;
}

export function makeDeps(
  llm: FakeLlm,
  overrides: { ratePerMinute?: number; dailyCap?: number; perClientDailyCap?: number; env?: Record<string, string> } = {},
) {
  const config = loadConfig({ MAX_INPUT_CHARS: "200", MAX_HISTORY_MESSAGES: "4", ...overrides.env });
  const systemPrompt = buildSystemPrompt(config.productName, CANARY);
  const logs: string[] = [];
  const deps: ChatDeps = {
    config,
    llm,
    sessions: new SessionStore(config.sessionTtlMs, config.maxSessions, config.maxHistoryMessages),
    outputGuard: createOutputGuard(systemPrompt, CANARY),
    systemPrompt,
    limiter: new SlidingWindowLimiter(overrides.ratePerMinute ?? 1000, 60_000),
    daily: new DailyCap(overrides.dailyCap ?? 1_000_000),
    clientDaily: new KeyedDailyCap(overrides.perClientDailyCap ?? 1_000_000),
    log: (event) => logs.push(event),
  };
  return { deps, logs, systemPrompt };
}
