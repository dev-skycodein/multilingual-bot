// The language lock: which language the bot answers in.
//
// The user's rule: whatever language the user starts in, every reply (answers, declines, off-topic, retries,
// busy messages) stays in it until the USER changes language. The user changes it by writing a real message in
// another language, or by asking for one ("answer in English", "ab French me baat karo").
//
// What counts as evidence, strongest first:
//   1. an explicit request for one of the six languages (saved)
//   2. the word-list detector is sure about a message of 3+ words (saved), or about the very first message (saved)
//   3. the classifier's language: the only evidence when there is no lock yet (saved only for a message of 3+ words);
//      once there is a lock it can only move the reply to English ("other"), for a message of 3+ words
//   4. the conversation's language so far
// A message of fewer than 3 words ("ok", "Okay", "no", "Hotel", "Team") cannot change the language: these words
// are shared by several languages and the detector and the classifier both get them wrong.

import type { Detected, Lang } from "./language.ts";
import type { ModelLanguage } from "../llm.ts";

/** Messages shorter than this cannot change the conversation's language (an explicit request still can). */
export const MIN_WORDS_TO_SWITCH = 3;

export function wordCount(text: string): number {
  return text.split(/[^\p{L}']+/u).filter((w) => /\p{L}/u.test(w)).length;
}

// Names of the six languages, written in each of the six (and in English). Lower case, accents optional.
const NAMES: [Lang, string[]][] = [
  ["en", ["english", "inglés", "ingles", "inglês", "anglais", "englisch", "inglese"]],
  ["es", ["spanish", "español", "espanol", "castellano", "espagnol", "spanisch", "spagnolo", "espanhol"]],
  ["fr", ["french", "francés", "frances", "francês", "français", "francais", "französisch", "franzosisch", "francese"]],
  ["pt", ["portuguese", "portugués", "portugues", "português", "portugais", "portugiesisch", "portoghese"]],
  ["de", ["german", "alemán", "aleman", "alemão", "alemao", "allemand", "deutsch", "tedesco"]],
  ["it", ["italian", "italiano", "italien", "italienisch"]],
];
const NAME_TO_LANG = new Map<string, Lang>(NAMES.flatMap(([l, ns]) => ns.map((n) => [n, l] as const)));
const NAME_ALT = [...NAME_TO_LANG.keys()].join("|");

// "in English", "en español", "em português", "auf Englisch", "to German", "into French", "zu Deutsch", "ins Englische"
const AFTER_PREP = new RegExp(`(?:^|[^\\p{L}])(?:in|into|to|en|em|a|al|au|auf|zu|zum|ins|su)\\s+(?:the\\s+)?(${NAME_ALT})(?![\\p{L}])`, "iu");
// Roman Urdu: "French me baat karo", "English mein jawab do"
const URDU_STYLE = new RegExp(`(?:^|[^\\p{L}])(${NAME_ALT})\\s+(?:me|mein|main)\\s+(?:baat|jawab|bolo|bol|likho|reply|answer)`, "iu");
// A verb about answering, speaking, writing or switching. Without one, only very short messages count ("In English, please").
const VERB = new RegExp(
  "(?:^|[^\\p{L}])(?:answer|reply|respond|speak|talk|write|continue|switch|change|chat|" +
    "responde|responder|contesta|contestar|habla|háblame|hablemos|escribe|continúa|continua|cambia|cambiar|" +
    "réponds|reponds|répondez|parle|parlons|écris|ecris|continue|passe|passer|changeons|" +
    "responda|fale|fala|escreva|mude|muda|" +
    "antworte|antworten|sprich|sprechen|schreibe|schreib|wechsle|wechseln|" +
    "rispondi|rispondere|parla|parliamo|scrivi|passa|cambiamo|" +
    "baat|jawab|bolo)(?![\\p{L}])",
  "iu",
);
// A translation job names a language but does not ask the conversation to move.
const TRANSLATION = /(?:^|[^\p{L}])(?:translat|traduc|traduz|übersetz|uebersetz|tradu)/iu;

/**
 * The language the user explicitly asked to continue in, if it is one of the six. A translation request, a
 * question about which languages exist, or a request for an unsupported language is not a request.
 */
export function requestedLanguage(text: string): Lang | undefined {
  if (TRANSLATION.test(text)) return undefined;
  const m = URDU_STYLE.exec(text) ?? AFTER_PREP.exec(text);
  if (!m) return undefined;
  if (wordCount(text) > 4 && !VERB.test(text)) return undefined;
  return NAME_TO_LANG.get(m[1]!.toLowerCase());
}

/** Where the language came from: used to word the hint for the model. */
export type LangSource = "request" | "message" | "lock" | "model" | "none";

export interface Resolved {
  /** The language to answer in (and to write fixed messages in). "unknown" only when there is no evidence at all. */
  lang: Detected;
  /** Set only when the evidence is strong enough to make this the conversation's language. */
  save?: Lang;
  source: LangSource;
}

export function resolveLanguage(o: {
  text: string;
  detected: Detected;
  modelLang?: ModelLanguage;
  sticky?: Lang;
}): Resolved {
  const requested = requestedLanguage(o.text);
  if (requested) return { lang: requested, save: requested, source: "request" };

  const long = wordCount(o.text) >= MIN_WORDS_TO_SWITCH;
  if (o.detected === "other") return { lang: "other", source: "message" }; // another script: it is certainly not the conversation's language
  if (o.detected !== "unknown") {
    if (!o.sticky || long) return { lang: o.detected, save: o.detected, source: "message" };
    return { lang: o.sticky, source: "lock" };
  }
  // The detector is not sure. The classifier reads the whole message, so it is the only evidence when there is no
  // lock yet. Once there is a lock it can only say "another script/language outside the six" for a real message: a
  // classifier that says "en" for "ok" is exactly the failure this lock exists to stop.
  if (o.modelLang && !o.sticky) {
    // A guess becomes the conversation's language only when it comes from a real message, never from one word.
    const save = long && o.modelLang !== "other" ? o.modelLang : undefined;
    return save ? { lang: o.modelLang, save, source: "model" } : { lang: o.modelLang, source: "model" };
  }
  if (long && o.modelLang === "other") return { lang: "other", source: "model" };
  if (o.sticky) return { lang: o.sticky, source: "lock" };
  return { lang: "unknown", source: "none" };
}
