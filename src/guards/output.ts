// Output guard: block a reply that leaks the canary or copies long runs of the
// system prompt. This is a net for accidents and successful extraction attempts,
// not a proof that nothing can leak (a paraphrase would pass).

const SHINGLE_WORDS = 12;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export interface OutputGuard {
  check(reply: string): { ok: true } | { ok: false; reason: "canary" | "prompt_copy" | "empty" };
}

export function createOutputGuard(systemPrompt: string, canary: string): OutputGuard {
  const promptWords = words(systemPrompt);
  const shingles = new Set<string>();
  for (let i = 0; i + SHINGLE_WORDS <= promptWords.length; i++) {
    shingles.add(promptWords.slice(i, i + SHINGLE_WORDS).join(" "));
  }
  const canaryLower = canary.toLowerCase();

  return {
    check(reply: string) {
      if (reply.trim().length === 0) return { ok: false, reason: "empty" };
      const compact = reply.toLowerCase().normalize("NFKC").replace(/[^a-z0-9]/g, "");
      if (compact.includes(canaryLower.replace(/[^a-z0-9]/g, ""))) return { ok: false, reason: "canary" };
      const replyWords = words(reply);
      for (let i = 0; i + SHINGLE_WORDS <= replyWords.length; i++) {
        if (shingles.has(replyWords.slice(i, i + SHINGLE_WORDS).join(" "))) {
          return { ok: false, reason: "prompt_copy" };
        }
      }
      return { ok: true };
    },
  };
}
