// SkyCodein AI provider: an OpenAI-style chat completions API (see API.md, which is git-ignored).
// Plain fetch, no SDK. Facts from API.md that shape this file:
//  - stateless: the whole conversation is sent every time
//  - only the newest 20 messages are used, and only while they fit in 8000 characters; OUR system prompt
//    counts as a message, so a long history could push it out. fitToBudget() prevents that.
//  - our system message is applied AFTER SkyCodein's own instructions and cannot replace them
//  - 30 requests per minute per key, one reply at a time, 8 waiting (the chat makes 2 calls per message)
import { CLASSIFIER_SYSTEM, EmptyReplyError, parseVerdict, trimTruncated, wrapForClassifier } from "./llm.ts";
import type { LlmClient } from "./llm.ts";
import type { Turn } from "./sessions.ts";

export interface ApiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SkycodeinOptions {
  model: string;
  classifierModel: string;
  maxOutputTokens: number;
  baseUrl: string;
  /** Defaults to SKYCODEIN_API_KEY. */
  apiKey?: string;
  /** Characters of conversation sent per request (the API's own limit is 8000; we keep a margin). */
  maxChars?: number;
  /** Messages sent per request including the system message (the API keeps the newest 20). */
  maxMessages?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const JSON_HINT = `\n\nReturn ONLY a JSON object: {"verdict":"SAFE"} or {"verdict":"UNSAFE"}.`;

/** Error from the API. `message` never contains the key. */
export class SkycodeinError extends Error {
  override name = "SkycodeinError";
  status?: number;
  retryAfterSeconds?: number;
}

/**
 * Builds the message list: system prompt first (always whole), then the newest part of the history that fits.
 * Oldest history goes first. The newest message is always kept (cut if it alone is too long).
 */
export function fitToBudget(system: string, history: Turn[], maxChars: number, maxMessages: number): ApiMessage[] {
  const room = Math.max(0, maxChars - system.length);
  const kept: ApiMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0 && kept.length < maxMessages - 1; i--) {
    const t = history[i]!;
    if (kept.length === 0) {
      // The newest message is mandatory.
      const content = t.content.length > room ? t.content.slice(0, room).toWellFormed() : t.content;
      kept.unshift({ role: t.role, content });
      used += content.length;
      continue;
    }
    if (used + t.content.length > room) break;
    kept.unshift({ role: t.role, content: t.content });
    used += t.content.length;
  }
  // A conversation should start with a user message.
  while (kept.length > 1 && kept[0]!.role !== "user") kept.shift();
  return [{ role: "system", content: system }, ...kept];
}

export function createSkycodeinLlm(opts: SkycodeinOptions): LlmClient {
  const doFetch = opts.fetch ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const maxChars = opts.maxChars ?? 7000;
  const maxMessages = opts.maxMessages ?? 18;
  const timeoutMs = opts.timeoutMs ?? 45_000;

  const scrub = (text: string, key: string): string => {
    let out = text;
    if (key) out = out.split(key).join("[key]");
    return out.replace(/sca-[A-Za-z0-9_-]{6,}/g, "[key]");
  };

  async function call(body: Record<string, unknown>): Promise<{ text: string; finish: string | undefined }> {
    const key = opts.apiKey ?? process.env.SKYCODEIN_API_KEY ?? "";
    if (!key) throw new SkycodeinError("SKYCODEIN_API_KEY is not set");
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ ...body, stream: false }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new SkycodeinError(scrub(`request failed: ${(e as Error).name}: ${(e as Error).message}`, key));
    }
    const raw = await res.text();
    if (!res.ok) {
      let detail = "";
      try {
        const err = (JSON.parse(raw) as { error?: { code?: string; message?: string } }).error;
        detail = `${err?.code ?? ""} ${err?.message ?? ""}`.trim();
      } catch {
        /* body was not JSON */
      }
      const e = new SkycodeinError(scrub(`HTTP ${res.status} ${detail}`.trim().slice(0, 300), key));
      e.status = res.status;
      const ra = Number(res.headers.get("Retry-After"));
      if (Number.isFinite(ra) && ra > 0) e.retryAfterSeconds = ra;
      throw e;
    }
    let data: { choices?: { message?: { content?: unknown }; finish_reason?: string }[] };
    try {
      data = JSON.parse(raw);
    } catch {
      throw new SkycodeinError("API answered with something that is not JSON");
    }
    const choice = data.choices?.[0];
    if (!choice) throw new SkycodeinError("API answer has no choices");
    const content = choice.message?.content;
    return { text: typeof content === "string" ? content.trim() : "", finish: choice.finish_reason };
  }

  return {
    async classify(text, context) {
      const { text: out } = await call({
        model: opts.classifierModel,
        max_tokens: 32,
        temperature: 0,
        // Live finding: as plain text the API's own persona answers the user instead of the filter prompt.
        // A JSON schema forces {"verdict":"SAFE"|"UNSAFE"} every time.
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "verdict",
            schema: {
              type: "object",
              properties: { verdict: { type: "string", enum: ["SAFE", "UNSAFE"] } },
              required: ["verdict"],
              additionalProperties: false,
            },
          },
        },
        messages: [
          { role: "system", content: CLASSIFIER_SYSTEM + JSON_HINT },
          { role: "user", content: wrapForClassifier(text, context) },
        ],
      });
      return parseVerdict(out);
    },

    async reply(system, history) {
      const { text, finish } = await call({
        model: opts.model,
        max_tokens: opts.maxOutputTokens,
        messages: fitToBudget(system, history, maxChars, maxMessages),
      });
      if (finish === "content_filter") return { kind: "refusal" };
      // The API sometimes puts its own status text in front of the answer.
      const clean = text.replace(/^(?:\s*live search did not run\.?\s*)+/i, "").trim();
      if (!clean) throw new EmptyReplyError(`no text in reply (finish_reason=${finish ?? "none"})`);
      // Customers must only ever meet the product's assistant, never the provider's persona.
      if (/sky\s*codein/i.test(clean)) return { kind: "refusal" };
      return { kind: "text", text: finish === "length" ? trimTruncated(clean) : clean };
    },
  };
}
