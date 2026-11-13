// Output guard: block a reply that leaks the canary or copies the system prompt.
//
// It is a net for accidents and for successful extraction attempts, not a proof that nothing can
// leak: a real paraphrase or a translation of the prompt still passes (the classifier and the model
// are the layers for that). What it catches, and why (each point has a test in test/output-hard.test.ts):
//  - the canary, or any 10-character piece of it (so half of it in one reply is enough), also when
//    it is spaced, re-cased, written with zero-width characters or Cyrillic look-alikes, reversed,
//    or written as base64 or hex.
//  - copies of the prompt: any 10 consecutive words of the prompt. A second pass drops every reply
//    word that does not occur in the prompt first and looks for 12, so inserting a filler word
//    ("BANANA") or numbers between the words does not hide a copy.
//  - two public sentences are excluded: the list of the six supported languages, and the scope
//    ("what the assistant can do and general questions about the product").

import { foldMixedScript } from "./confusables.ts";

// A live run showed that an 8-word window also catches natural replies that restate the public scope,
// so the window is 10 words. The second pass (filler words removed) uses 12: a real copy is long.
const SHINGLE_WORDS = 10;
const FILTERED_SHINGLE_WORDS = 12;
const CANARY_WINDOW = 10;
const BASE64_WINDOW = 12;
const HEX_WINDOW = 16;
// Public sentences: the assistant must be free to say which languages it supports and what it is for.
const PUBLIC_PHRASES = /english spanish french portuguese german (?:and )?italian|what (?:the|this) assistant can do(?: and)? general questions about the product/g;

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu;
/** Removes invisible characters but keeps line breaks and tabs, which separate words. */
const strip = (t: string): string => t.normalize("NFKC").replace(INVISIBLE, (ch) => (/\s/u.test(ch) ? ch : ""));

/** Lower-case words with punctuation removed; the public language list is replaced by a separator. */
function words(text: string): string[] {
  const folded = foldMixedScript(strip(text)).toLowerCase();
  const plain = folded.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return plain.replace(PUBLIC_PHRASES, " | ").split(" ").filter(Boolean);
}

function ngrams(ws: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= ws.length; i++) {
    const g = ws.slice(i, i + n);
    if (!g.includes("|")) out.push(g.join(" "));
  }
  return out;
}

function windows(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + size <= s.length; i++) out.push(s.slice(i, i + size));
  return out;
}

const compact = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface OutputGuard {
  check(reply: string): { ok: true } | { ok: false; reason: "canary" | "prompt_copy" | "empty" };
}

export function createOutputGuard(systemPrompt: string, canary: string): OutputGuard {
  const promptWords = words(systemPrompt);
  const vocab = new Set(promptWords);
  const shingles = new Set(ngrams(promptWords, SHINGLE_WORDS));
  const filteredShingles = new Set(ngrams(promptWords, FILTERED_SHINGLE_WORDS));

  // Pieces of the canary to look for in the lower-case alphanumeric form of a reply.
  const canaryCompact = compact(canary);
  const plainPieces = new Set([...windows(canaryCompact, CANARY_WINDOW), ...windows([...canaryCompact].reverse().join(""), CANARY_WINDOW)]);
  const hexPieces = new Set(windows(Buffer.from(canary).toString("hex"), HEX_WINDOW));
  // Base64 depends on where the text starts inside the encoded message: try three alignments and
  // keep only the middle of each, which is the same however the surrounding text looks.
  const b64Pieces = new Set<string>();
  for (let pad = 0; pad < 3; pad++) {
    const enc = Buffer.from(" ".repeat(pad) + canary).toString("base64").replace(/=+$/, "");
    for (const w of windows(enc.slice(4, -4), BASE64_WINDOW)) b64Pieces.add(w);
  }

  return {
    check(reply: string) {
      if (reply.trim().length === 0) return { ok: false, reason: "empty" };

      const folded = foldMixedScript(strip(reply));
      const squashed = compact(folded);
      for (const p of plainPieces) if (squashed.includes(p)) return { ok: false, reason: "canary" };
      for (const p of hexPieces) if (squashed.includes(p)) return { ok: false, reason: "canary" };
      const rawNoSpace = folded.replace(/\s+/g, "");
      for (const p of b64Pieces) if (rawNoSpace.includes(p)) return { ok: false, reason: "canary" };

      const replyWords = words(reply);
      for (const g of ngrams(replyWords, SHINGLE_WORDS)) if (shingles.has(g)) return { ok: false, reason: "prompt_copy" };
      const onlyPromptWords = replyWords.filter((w) => vocab.has(w) || w === "|");
      for (const g of ngrams(onlyPromptWords, FILTERED_SHINGLE_WORDS)) if (filteredShingles.has(g)) return { ok: false, reason: "prompt_copy" };
      return { ok: true };
    },
  };
}
