// Deterministic language detection for the six supported languages.
//
// Why: the main model sometimes answered in the wrong language (for example in the language a user
// asked to TRANSLATE INTO), and the fixed decline text was always shown in all six languages.
// The detector's answer is only ever used for two things: picking the language of a fixed message,
// and a one-line hint for the model. It is advisory, so it is built to say "unknown" instead of
// guessing: it needs at least two distinct pieces of evidence and a clear lead over the runner-up.
//
// It is NOT a general language identifier. It only separates the six supported languages from each
// other, from non-Latin scripts ("other"), and from anything it is unsure about ("unknown").

export type Lang = "en" | "es" | "fr" | "pt" | "de" | "it";
export type Detected = Lang | "other" | "unknown";
export const SUPPORTED_LANGS: readonly Lang[] = ["en", "es", "fr", "pt", "de", "it"];

// Words that are (nearly) exclusive to one language among the six. Words shared by two or more of
// them ("de", "que", "con", "para", "instructions", "ignore", "como"...) are left out on purpose.
const MARKERS: Record<Lang, string[]> = {
  en: ["the", "and", "you", "your", "what", "how", "can", "with", "is", "are", "do", "does", "this", "that", "for", "about", "please",
    "my", "me", "it", "of", "to", "help", "hello", "hi", "i", "which", "who", "all", "previous", "reply", "languages", "much", "cost",
    "month", "forgot", "password", "reset", "administrator", "account", "print", "language", "speak", "tell", "show", "write", "would", "could"],
  es: ["los", "las", "una", "y", "qué", "cómo", "cuál", "cuánto", "quién", "puedo", "puedes", "ayudar", "ayudarte", "ayuda", "hola",
    "gracias", "usted", "está", "soy", "eres", "tengo", "necesito", "favor", "mi", "mis", "tus", "contraseña", "cuenta", "todas",
    "anteriores", "instrucciones", "muéstrame", "traduce", "francés", "olvidé", "restablecerla", "cuesta", "mes", "idioma", "también",
    "pero", "porque", "dónde", "dime", "muestra"],
  fr: ["les", "des", "je", "vous", "pour", "et", "est", "une", "avec", "peux", "pouvez", "aider", "sur", "pas", "ce", "qui", "votre",
    "mon", "mot", "passe", "bonjour", "merci", "comment", "oublié", "tes", "ton", "traduis", "précédentes", "toutes", "affiche",
    "coûte", "combien", "mois", "par", "quoi", "allemand", "complètes", "système", "voudrais", "savoir", "compte", "j'", "qu'", "n'", "m'", "c'"],
  pt: ["você", "voce", "não", "uma", "um", "com", "posso", "ajudar", "olá", "obrigado", "obrigada", "senha", "minha", "meu", "sua",
    "seu", "suas", "preciso", "conta", "mostre", "traduza", "esqueci", "mês", "custa", "é", "são", "estou", "também", "tudo",
    "dúvidas", "preços", "isso", "isto", "eu", "ajuda", "faço", "pode", "instruções", "configuração"],
  de: ["der", "das", "und", "ich", "nicht", "mit", "ist", "zu", "ein", "eine", "kann", "helfen", "ihnen", "bei", "sie", "ihre", "über",
    "mein", "meinem", "wie", "wobei", "können", "mir", "bitte", "hallo", "brauche", "hilfe", "konto", "passwort", "vergessen",
    "zurücksetzen", "übersetze", "anweisungen", "deine", "deinen", "alle", "vorherigen", "zeig", "kostet", "pro", "monat",
    "vollständigen", "ins", "englische", "habe", "dein", "wer", "mich", "uns", "danke"],
  it: ["il", "che", "di", "non", "sono", "posso", "aiutare", "aiutarmi", "della", "è", "ti", "puoi", "tuo", "tua", "tue", "ciao",
    "grazie", "cosa", "costa", "mese", "dimenticato", "reimpostarla", "ho", "bisogno", "aiuto", "mio", "mia", "traduci", "istruzioni",
    "precedenti", "tutte", "mostra", "portoghese", "complete", "configurazione", "quale", "quali", "lingue", "parli", "dove", "perché"],
};

// A few characters that point strongly to one language. They only count if at least one word agrees.
const CHAR_HINTS: [RegExp, Lang, number][] = [
  [/[¿¡ñ]/u, "es", 3],
  [/[ãõ]/u, "pt", 3],
  [/ß/u, "de", 3],
  [/[äöü]/u, "de", 1],
  [/[êâîôûœ]/u, "fr", 1],
];

const WORDS: Record<Lang, Set<string>> = Object.fromEntries(
  SUPPORTED_LANGS.map((l) => [l, new Set(MARKERS[l])]),
) as Record<Lang, Set<string>>;

function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}']+/u)) {
    if (!raw) continue;
    const cut = raw.indexOf("'");
    if (cut > 0 && cut < raw.length - 1) {
      out.push(raw.slice(0, cut + 1)); // "j'" in "j'ai"
      out.push(raw.slice(cut + 1));
    } else {
      out.push(raw.replace(/'/g, ""));
    }
  }
  return out;
}

export function detectLanguage(text: string): Detected {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (letters.length === 0) return "unknown";
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  if (latin / letters.length < 0.5) return "other";

  const toks = tokens(text);
  const score = {} as Record<Lang, number>;
  for (const l of SUPPORTED_LANGS) {
    const hits = toks.filter((t) => WORDS[l].has(t)).length;
    let bonus = 0;
    if (hits > 0) for (const [re, lang, w] of CHAR_HINTS) if (lang === l && re.test(text)) bonus += w;
    score[l] = hits + bonus;
  }
  const ranked = [...SUPPORTED_LANGS].sort((a, b) => score[b] - score[a]);
  const best = ranked[0]!;
  const second = ranked[1]!;
  if (score[best] >= 2 && score[best] - score[second] >= 2) return best;
  return "unknown";
}
