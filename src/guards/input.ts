// Input guard: type check, length limit, Unicode clean-up.
// NFKC folds look-alike forms (e.g. full-width letters) to plain ones, and the
// strip removes invisible characters that are used to hide instructions.

export type InputResult = { ok: true; text: string } | { ok: false; reason: "not_string" | "empty" | "too_long" };

// \p{Cc} control chars (we keep \n and \t), \p{Cf} format chars (zero-width,
// bidi overrides, Unicode "tag" characters), \p{Co} private use, \p{Cn} unassigned.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu;

export function normalizeInput(raw: unknown, maxChars: number): InputResult {
  if (typeof raw !== "string") return { ok: false, reason: "not_string" };
  // Cheap check first so a huge string is never normalised.
  if (raw.length > maxChars * 4) return { ok: false, reason: "too_long" };

  const cleaned = raw
    .normalize("NFKC")
    .replace(INVISIBLE, (ch) => (ch === "\n" || ch === "\t" ? ch : ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length === 0) return { ok: false, reason: "empty" };
  if (cleaned.length > maxChars) return { ok: false, reason: "too_long" };
  return { ok: true, text: cleaned };
}
