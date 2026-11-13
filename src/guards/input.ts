// Input guard: type check, length limit, Unicode clean-up.
//
// What the clean-up does, and why (each point has a test in test/unicode.test.ts):
//  - lone surrogates are made well-formed, so the model API never sees broken UTF-16.
//  - NFKC folds look-alike forms (full-width, math-bold, circled letters) to plain ones.
//  - invisible characters that can hide instructions are removed: control, format (zero-width,
//    bidi, Unicode "tag" characters), private use, unassigned, variation selectors ("emoji
//    smuggling") and the invisible fillers that are letters or marks (Hangul fillers, Braille
//    blank, combining grapheme joiner, Khmer inherent vowels, Mongolian selectors).
//  - ZWNJ / ZWJ are real parts of Persian, Urdu and Indic text and of emoji sequences, so they are
//    only removed when they touch a Latin letter (where they can only be used to split a word).
//  - more than three combining marks on one letter ("Zalgo") are cut.
//  - a word that mixes Latin with Cyrillic/Greek look-alikes is folded to Latin.
//  - the length limit counts characters (code points), not UTF-16 units.

import { foldMixedScript } from "./confusables.ts";

export type InputResult = { ok: true; text: string } | { ok: false; reason: "not_string" | "empty" | "too_long" };

// \p{Cc} control chars (we keep \n and \t), \p{Cf} format chars, \p{Co} private use, \p{Cn} unassigned.
// ZWNJ U+200C and ZWJ U+200D are Cf but are handled separately below.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu;
const EXTRA_INVISIBLE = /[︀-️\u{E0100}-\u{E01EF}͏ᅟᅠㅤﾠ⠀឴឵᠋-᠍᠏]/gu;
const JOINER = /[‌‍]/u;
const JOINER_NEXT_TO_LATIN = /(?<=\p{Script=Latin})[‌‍]|[‌‍](?=\p{Script=Latin})/gu;
const MARK_RUN = /(\p{M}{3})\p{M}+/gu;

export function normalizeInput(raw: unknown, maxChars: number): InputResult {
  if (typeof raw !== "string") return { ok: false, reason: "not_string" };
  // Cheap check first so a huge string is never normalised.
  if (raw.length > maxChars * 4) return { ok: false, reason: "too_long" };

  const stripped = raw
    .toWellFormed()
    .normalize("NFKC")
    .replace(INVISIBLE, (ch) => (ch === "\n" || ch === "\t" || JOINER.test(ch) ? ch : ""))
    .replace(EXTRA_INVISIBLE, "")
    .replace(JOINER_NEXT_TO_LATIN, "")
    .replace(MARK_RUN, "$1");

  const cleaned = foldMixedScript(stripped)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length === 0) return { ok: false, reason: "empty" };
  if ([...cleaned].length > maxChars) return { ok: false, reason: "too_long" };
  return { ok: true, text: cleaned };
}
