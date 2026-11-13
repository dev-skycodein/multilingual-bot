// Checks a model reply that lists languages. The bot supports exactly six, so a list must name each of them once.
//
// Why: live, "Quali lingue parli?" was answered "Parlo italiano, inglese, francese, portoghese, tedesco e
// italiano." (Spanish missing, Italian twice). A prompt rule did not stop that, so the server checks it.
//
// A reply counts as a language list when it names at least four of the six (in any of the six languages).
// Then it must name all six, and none twice. Replies that mention one to three languages are left alone.
import type { Lang } from "./language.ts";

// How each language is written in the six languages, without accents too (people and models drop them).
const NAME_FORMS: Record<Lang, string[]> = {
  en: ["english", "inglés", "ingles", "anglais", "inglês", "englisch", "inglese"],
  es: ["spanish", "español", "espanol", "espagnol", "espanhol", "spanisch", "spagnolo"],
  fr: ["french", "francés", "frances", "français", "francais", "francês", "französisch", "franzosisch", "francese"],
  pt: ["portuguese", "portugués", "portugues", "portugais", "português", "portugiesisch", "portoghese"],
  de: ["german", "alemán", "aleman", "allemand", "alemão", "alemao", "deutsch", "tedesco"],
  it: ["italian", "italiano", "italien", "italienisch"],
};

const LOOKUP = new Map<string, Lang>();
for (const [lang, forms] of Object.entries(NAME_FORMS) as [Lang, string[]][]) for (const f of forms) LOOKUP.set(f, lang);

/** True when the reply is a list of languages that is not exactly the six supported ones, each once. */
export function languageListProblem(reply: string): boolean {
  const counts = new Map<Lang, number>();
  for (const word of reply.toLowerCase().split(/[^\p{L}]+/u)) {
    const lang = LOOKUP.get(word);
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  if (counts.size < 4) return false;
  return counts.size < 6 || [...counts.values()].some((n) => n > 1);
}
