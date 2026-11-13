// Deterministic language detection for the six supported languages.
//
// Why: the main model sometimes answered in the wrong language (for example in the language a user
// asked to TRANSLATE INTO, or in English because it was unsure), and the fixed decline text was always
// shown in all six languages. The detector's answer is only ever used for three things: picking the
// language of a fixed message, a one-line hint for the model, and checking the language of a reply.
// It is advisory, so it is built to say "unknown" instead of guessing: it needs evidence and a clear
// lead over the runner-up.
//
// It is NOT a general language identifier. It only separates the six supported languages from each
// other, from non-Latin scripts ("other"), and from anything it is unsure about ("unknown").

export type Lang = "en" | "es" | "fr" | "pt" | "de" | "it";
export type Detected = Lang | "other" | "unknown";
export const SUPPORTED_LANGS: readonly Lang[] = ["en", "es", "fr", "pt", "de", "it"];

// Frequent everyday words per language. A word that means something else in another of the six
// ("me", "i", "was", "will", "son", "c'" ...) is left out. A word that two or more of the six share is
// listed in SHARED, so every language that owns it is credited equally and nobody is favoured by accident.
const MARKERS: Record<Lang, string[]> = {
  en: ["the", "and", "you", "your", "what", "how", "can", "with", "is", "are", "does", "did", "this", "that", "for", "about", "please",
    "my", "it", "of", "to", "help", "hello", "hi", "which", "who", "all", "previous", "reply", "languages", "much", "cost",
    "month", "forgot", "password", "reset", "administrator", "account", "print", "language", "speak", "tell", "show", "write", "would", "could",
    "there", "free", "trial", "weather", "like", "want", "need", "order", "today", "more", "features", "good", "morning", "thank", "thanks",
    "not", "have", "has", "any", "some", "from", "we", "our", "they", "if", "just", "yes", "here", "works", "work", "were",
    "been", "talk", "one", "new", "get", "also", "by", "at", "its", "their", "them", "these", "those", "when",
    "where", "why", "should", "doing", "integrate", "integrates", "price", "evening", "afternoon", "again", "very",
    "pleasure", "welcome", "glad", "happy", "sorry", "okay", "anytime", "english", "spanish", "french", "portuguese", "german", "italian",
    "write", "explain", "give", "describe", "summarize", "summarise", "essay", "list", "create", "search", "find"],
  es: ["los", "las", "y", "qué", "cómo", "cuál", "cuánto", "quién", "puedo", "puedes", "ayudar", "ayudarte", "ayuda", "hola",
    "gracias", "usted", "está", "soy", "eres", "tengo", "necesito", "favor", "mis", "tus", "contraseña", "cuenta", "todas",
    "anteriores", "instrucciones", "muéstrame", "traduce", "francés", "olvidé", "restablecerla", "cuesta", "mes", "idioma", "también",
    "pero", "porque", "dónde", "dime", "muestra",
    "el", "muy", "más", "muchas", "muchos", "buenos", "buenas", "días", "tardes", "noches", "quisiera", "quiero", "puede", "pueden", "tiempo",
    "hace", "hoy", "hay", "prueba", "gratis", "funciona", "funciones", "cuéntame", "pedido", "pedidos", "idiomas", "hablas", "hablar",
    "pregunta", "esto", "sin", "hasta", "cuando", "ese", "eso", "mucho", "hacer", "quiere", "necesita", "tienen",
    "tiene", "ahora", "siempre", "precio", "precios", "integra", "integrar", "podría", "podrías", "gustaría", "contactar", "ayudarme",
    "ayúdame", "nuestro", "nuestra", "vuestro", "usar", "usarlo", "mí", "tú", "él", "ella", "ellos", "estoy", "estás", "somos",
    "inglés", "español", "francés", "portugués", "alemán",
    "escribe", "explícame", "dame", "hazme", "describe", "resume", "crea", "busca", "ensayo", "lista"],
  fr: ["les", "des", "je", "vous", "pour", "et", "est", "une", "avec", "peux", "pouvez", "aider", "sur", "pas", "ce", "qui", "votre",
    "mon", "mot", "passe", "bonjour", "merci", "comment", "oublié", "tes", "ton", "traduis", "précédentes", "toutes", "affiche",
    "coûte", "combien", "mois", "par", "quoi", "allemand", "complètes", "système", "voudrais", "savoir", "compte", "j'", "qu'", "n'",
    "au", "aux", "dans", "sont", "ça", "cela", "être", "avoir", "fait", "faire", "fonctionne", "fonctionnalités", "fonctions", "essai", "gratuit",
    "gratuite", "langues", "parlez", "parler", "personne", "commande", "beaucoup", "aidez", "davantage", "aujourd'", "maintenant", "toujours",
    "jamais", "très", "où", "quand", "quel", "quelle", "quels", "quelles", "oui", "moi", "toi", "nous", "ils", "elles", "elle", "notre", "leur",
    "leurs", "cette", "ces", "cet", "tout", "tous", "toute", "prix", "coût", "besoin", "voulez", "veux", "puis", "bonsoir", "salut",
    "anglais", "espagnol", "français", "portugais", "allemand", "italien",
    "écris", "explique", "donne", "donnez", "raconte", "décris", "résume", "crée", "cherche", "essai", "liste"],
  pt: ["você", "voce", "não", "uma", "um", "com", "posso", "ajudar", "olá", "obrigado", "obrigada", "senha", "minha", "meu", "sua",
    "seu", "suas", "preciso", "conta", "mostre", "traduza", "esqueci", "mês", "custa", "é", "são", "estou", "também", "tudo",
    "dúvidas", "preços", "isso", "isto", "eu", "ajuda", "faço", "pode", "instruções", "configuração",
    "os", "muito", "muita", "muitos", "bom", "boa", "dia", "noite", "gostaria", "quero", "podem", "hoje", "teste", "grátis",
    "fale", "falar", "fala", "pessoa", "dúvida", "bem", "sem", "onde", "fazer", "agora", "preço", "poderia", "contatar", "redefinir", "ele", "ela",
    "ao", "aos", "à", "às", "vocês", "num", "numa", "têm", "tem", "até", "idiomas", "pedido", "pedidos", "integra", "integrar", "nosso", "nossa",
    "oi", "tchau", "falo", "usar", "ainda", "mas", "já", "em", "foi", "tenho", "temos", "estamos", "esse", "essa",
    "inglês", "espanhol", "francês", "português", "alemão",
    "escreva", "explique", "conte", "descreva", "resuma", "crie", "procure", "ensaio", "lista"],
  de: ["der", "das", "und", "ich", "nicht", "mit", "ist", "zu", "ein", "eine", "kann", "helfen", "ihnen", "bei", "sie", "ihre", "über",
    "mein", "meinem", "wie", "wobei", "können", "mir", "bitte", "hallo", "brauche", "hilfe", "konto", "passwort", "vergessen",
    "zurücksetzen", "übersetze", "anweisungen", "deine", "deinen", "alle", "vorherigen", "zeig", "kostet", "pro", "monat",
    "vollständigen", "ins", "englische", "habe", "dein", "wer", "mich", "uns", "danke",
    "die", "den", "dem", "auf", "aus", "für", "von", "vom", "zum", "zur", "dass", "oder", "aber", "auch", "noch", "nur", "sehr", "mehr",
    "jetzt", "immer", "nie", "heute", "gibt", "wir", "ihr", "dich", "dir", "euch", "unser", "unsere", "welche", "welcher", "wo", "wann", "warum",
    "wieso", "kostenlose", "kostenlos", "testversion", "funktioniert", "funktionen", "sprachen", "sprechen", "sprichst", "frage", "bestellung",
    "guten", "morgen", "abend", "vielen", "dank", "möchte", "möchten", "kannst", "muss", "müssen", "wetter", "verbinden", "lässt", "sich",
    "erzähl", "erzählen", "tschüss", "englisch", "spanisch", "französisch", "portugiesisch", "deutsch", "italienisch", "schreibe", "schreib", "erkläre", "erklär", "gib", "beschreibe", "fasse", "aufsatz", "suche", "ja", "nein", "gut", "ihrer", "ihrem", "meine", "meiner", "diese", "dieser", "dieses", "einen", "einem"],
  it: ["il", "che", "di", "non", "sono", "posso", "aiutare", "aiutarmi", "della", "è", "ti", "puoi", "tuo", "tua", "tue", "ciao",
    "grazie", "cosa", "costa", "mese", "dimenticato", "reimpostarla", "ho", "bisogno", "aiuto", "mio", "mia", "traduci", "istruzioni",
    "precedenti", "tutte", "mostra", "portoghese", "complete", "configurazione", "quale", "quali", "lingue", "parli", "dove", "perché",
    "gli", "uno", "dei", "delle", "degli", "dello", "alla", "alle", "allo", "nel", "nella", "nei", "sul", "sulla", "sulle", "tra",
    "fra", "quanta", "quanti", "chi", "funziona", "funzionalità", "funzioni", "gratuita", "parlare", "domanda", "ordine", "buongiorno",
    "buonasera", "buonanotte", "salve", "prego", "aiutami", "vorrei", "voglio", "vuoi", "può", "possiamo", "oggi", "adesso", "mai", "molto",
    "più", "meno", "anche", "ancora", "sì", "siamo", "essere", "avere", "fare", "dimmi", "dammi", "dirmi", "ci", "vi", "noi", "voi", "lei", "loro",
    "questo", "questa", "questi", "queste", "quello", "quella", "nostro", "vostro", "suo", "sua", "sue", "miei", "tuoi", "altro", "altra", "tutto",
    "tutti", "bene", "come", "sapere", "aiutarti", "inglese", "spagnolo", "francese", "portoghese", "tedesco",
    "scrivi", "spiegami", "fammi", "raccontami", "parlami", "descrivi", "riassumi", "cerca", "crea", "elenca", "saggio",
    "sull'", "dell'", "nell'", "all'", "dall'", "un'", "quest'", "sullo", "dello", "arrivederci", "scusa", "scusi", "integra", "ordini", "informazioni"],
};

// Words that several of the six languages share. Every owner is credited, so the words cancel out in the
// comparison and only the words that tell the languages apart can decide.
const SHARED: [Lang[], string[]][] = [
  [["fr", "it"], ["il", "non", "l'", "d'", "m'", "s'", "ma", "mille", "le"]],
  [["it", "pt"], ["quanto", "sempre", "quando", "prova", "gratuito", "tempo"]],
  [["es", "pt"], ["por", "para", "sobre", "esta", "este", "existe", "recursos", "tarde", "mas", "nunca", "desde", "como", "saber", "funciona", "está"]],
  [["es", "it", "pt"], ["con"]],
  [["es", "it"], ["mi", "una", "persona", "lo", "del"]],
  [["es", "it", "pt"], ["italiano"]],
  [["es", "fr", "it"], ["un"]],
  [["fr", "pt"], ["mais", "ou"]],
  [["es", "fr"], ["en", "bien"]],
  [["es", "fr", "pt"], ["entre"]],
  [["es", "fr", "it", "pt"], ["se"]],
  [["es", "fr", "it"], ["si", "la"]],
  [["en", "pt"], ["do", "as"]],
  [["de", "fr"], ["des"]],
];

// A few characters that point strongly to one language. They only count if at least one word agrees.
const CHAR_HINTS: [RegExp, Lang, number][] = [
  [/[¿¡ñ]/u, "es", 3],
  [/[ãõ]/u, "pt", 3],
  [/ß/u, "de", 3],
  [/[äöü]/u, "de", 1],
  [/[êâîôûœ]/u, "fr", 1],
  [/[ìò]/u, "it", 1],
];

const WORDS: Record<Lang, Set<string>> = Object.fromEntries(
  SUPPORTED_LANGS.map((l) => [l, new Set(MARKERS[l])]),
) as Record<Lang, Set<string>>;
for (const [owners, words] of SHARED) for (const l of owners) for (const w of words) WORDS[l].add(w);

// Web addresses and e-mail addresses are not language ("com" is also a Portuguese word).
const NOT_WORDS = /\bhttps?:\/\/\S+|\bwww\.\S+|\S+@\S+|\S+\.(?:com|org|net|io|ai|app|dev|edu|gov)\b\S*/gi;

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
  return out.filter(Boolean);
}

/** Evidence per language for a Latin-script text, or undefined when it is not (mostly) Latin script or has no letters. */
function scoresOf(text: string): { score: Record<Lang, number>; tokenCount: number } | "other" | undefined {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (letters.length === 0) return undefined;
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  if (latin / letters.length < 0.5) return "other";

  const toks = tokens(text.replace(NOT_WORDS, " "));
  const score = {} as Record<Lang, number>;
  for (const l of SUPPORTED_LANGS) {
    const hits = toks.filter((t) => WORDS[l].has(t)).length;
    let bonus = 0;
    if (hits > 0) for (const [re, lang, w] of CHAR_HINTS) if (lang === l && re.test(text)) bonus += w;
    score[l] = hits + bonus;
  }
  return { score, tokenCount: toks.length };
}

export function detectLanguage(text: string): Detected {
  const r = scoresOf(text);
  if (r === undefined) return "unknown";
  if (r === "other") return "other";
  const { score, tokenCount } = r;
  const ranked = [...SUPPORTED_LANGS].sort((a, b) => score[b] - score[a]);
  const best = ranked[0]!;
  const second = ranked[1]!;
  const lead = score[best] - score[second];
  // A very short message ("Ciao!", "Grazie") has room for one word of evidence; longer ones need two.
  const short = tokenCount <= 3;
  if (short ? score[best] >= 1 && lead >= 1 : score[best] >= 2 && lead >= 2) return best;
  return "unknown";
}

/**
 * The languages a message could be written in: those with real evidence (at least two words) that are at most
 * one word behind the best one. Empty when there is no such evidence. A message that fits Spanish and Portuguese
 * equally returns both. Used to check a reply when the detector could not pick one language.
 */
export function candidateLanguages(text: string): Lang[] {
  const r = scoresOf(text);
  if (r === undefined || r === "other") return [];
  const best = Math.max(...SUPPORTED_LANGS.map((l) => r.score[l]));
  if (best < 2) return [];
  return SUPPORTED_LANGS.filter((l) => r.score[l] >= Math.max(2, best - 1)).sort((a, b) => r.score[b] - r.score[a]);
}
