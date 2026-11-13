import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, candidateLanguages, SUPPORTED_LANGS } from "../src/guards/language.ts";
import type { Lang } from "../src/guards/language.ts";

// Everyday customer messages, written fresh (NOT taken from the attack corpora the markers were tuned on).
// Written by the assistant, not reviewed by native speakers. "unknown" is an acceptable answer for a message
// with too little evidence; a WRONG language is never acceptable, because the answer picks the reply language.
const NATURAL: Record<Lang, string[]> = {
  en: ["Hi there!", "What can you do for me?", "How does OpBritops work?", "How much does it cost per month?",
    "Can you help me with my order?", "I forgot my password, how do I reset it?", "Does it integrate with Shopify?",
    "Thanks a lot for your help!", "Which languages do you speak?", "Is there a free trial?",
    "I would like to talk to a person please", "Good morning, I have a question about my account.",
    "What's the weather like in London today?", "Tell me more about the features."],
  es: ["¡Hola!", "¿Qué puedes hacer por mí?", "¿Cómo funciona OpBritops?", "¿Cuánto cuesta al mes?",
    "¿Me puedes ayudar con mi pedido?", "Olvidé mi contraseña, ¿cómo la restablezco?", "¿Se integra con Shopify?",
    "¡Muchas gracias por tu ayuda!", "¿Qué idiomas hablas?", "¿Hay una prueba gratuita?",
    "Quisiera hablar con una persona, por favor.", "Buenos días, tengo una pregunta sobre mi cuenta.",
    "¿Qué tiempo hace hoy en Madrid?", "Cuéntame más sobre las funciones."],
  fr: ["Bonjour !", "Que pouvez-vous faire pour moi ?", "Comment fonctionne OpBritops ?", "Combien ça coûte par mois ?",
    "Pouvez-vous m'aider avec ma commande ?", "J'ai oublié mon mot de passe, comment le réinitialiser ?",
    "Est-ce que ça s'intègre avec Shopify ?", "Merci beaucoup pour votre aide !", "Quelles langues parlez-vous ?",
    "Y a-t-il un essai gratuit ?", "Je voudrais parler à une personne, s'il vous plaît.",
    "Bonjour, j'ai une question sur mon compte.", "Quel temps fait-il aujourd'hui à Paris ?",
    "Parlez-moi davantage des fonctionnalités."],
  pt: ["Olá!", "O que você pode fazer por mim?", "Como funciona o OpBritops?", "Quanto custa por mês?",
    "Pode me ajudar com o meu pedido?", "Esqueci minha senha, como faço para redefinir?", "Ele se integra com o Shopify?",
    "Muito obrigado pela ajuda!", "Que idiomas você fala?", "Existe um teste gratuito?",
    "Gostaria de falar com uma pessoa, por favor.", "Bom dia, tenho uma dúvida sobre a minha conta.",
    "Como está o tempo hoje em Lisboa?", "Fale-me mais sobre os recursos."],
  de: ["Hallo!", "Was kannst du für mich tun?", "Wie funktioniert OpBritops?", "Wie viel kostet es pro Monat?",
    "Können Sie mir bei meiner Bestellung helfen?", "Ich habe mein Passwort vergessen, wie kann ich es zurücksetzen?",
    "Lässt es sich mit Shopify verbinden?", "Vielen Dank für Ihre Hilfe!", "Welche Sprachen sprechen Sie?",
    "Gibt es eine kostenlose Testversion?", "Ich möchte bitte mit einer Person sprechen.",
    "Guten Morgen, ich habe eine Frage zu meinem Konto.", "Wie ist das Wetter heute in Berlin?",
    "Erzähl mir mehr über die Funktionen."],
  it: ["Ciao!", "Cosa puoi fare per me?", "Come funziona OpBritops?", "Quanto costa al mese?",
    "Puoi aiutarmi con il mio ordine?", "Ho dimenticato la password, come posso reimpostarla?", "Si integra con Shopify?",
    "Grazie mille per l'aiuto!", "Quali lingue parli?", "C'è una prova gratuita?",
    "Vorrei parlare con una persona, per favore.", "Buongiorno, ho una domanda sul mio account.",
    "Che tempo fa oggi a Roma?", "Dimmi di più sulle funzionalità."],
};

for (const lang of SUPPORTED_LANGS) {
  test(`natural messages (${lang}): never a wrong language, and at least 12 of 14 recognised`, () => {
    const msgs = NATURAL[lang];
    const wrong = msgs.filter((m) => { const d = detectLanguage(m); return d !== lang && d !== "unknown"; });
    const right = msgs.filter((m) => detectLanguage(m) === lang);
    assert.deepEqual(wrong.map((m) => `${m} -> ${detectLanguage(m)}`), [], "wrong language");
    assert.ok(right.length >= 12, `${lang}: recognised ${right.length}/14; unknown: ${msgs.filter((m) => detectLanguage(m) === "unknown").join(" | ")}`);
  });
}

// Very short messages carry little evidence. A greeting or thanks is recognised; ambiguous scraps stay "unknown".
// Never a wrong language: the detected language picks the reply language.
test("short messages: greetings and thanks are recognised, ambiguous scraps are never given a wrong language", () => {
  const exact: [string, Lang][] = [["gracias", "es"], ["Danke!", "de"], ["Merci !", "fr"], ["Obrigado", "pt"], ["Grazie", "it"],
    ["thanks", "en"], ["Hola", "es"], ["Bonjour", "fr"], ["Ciao", "it"], ["Hallo", "de"], ["Olá", "pt"], ["Hello", "en"]];
  for (const [text, want] of exact) assert.equal(detectLanguage(text), want, text);
  // a scrap may be "unknown" or the right language, never another one
  const scraps: [string, Lang][] = [["me gusta", "es"], ["mi piace", "it"], ["me too", "en"], ["i miei ordini", "it"], ["ok grazie", "it"],
    ["non è vero", "it"], ["c'est bon", "fr"], ["das ist gut", "de"], ["isso é bom", "pt"], ["tudo bem", "pt"]];
  for (const [text, want] of scraps) {
    const d = detectLanguage(text);
    assert.ok(d === want || d === "unknown", `${text} -> ${d}`);
  }
  for (const text of ["ok", "no", "pizza", "123", "😀", "https://example.com"]) assert.equal(detectLanguage(text), "unknown", text);
});

// Live finding (2026-11-14): these everyday sentences were "unknown", so the bot answered them in English.
test("natural messages: sentences with several shared words are still recognised", () => {
  assert.equal(detectLanguage("Buongiorno, vorrei sapere se OpBritops si integra con Shopify."), "it");
  assert.equal(detectLanguage("Como está o tempo hoje em Lisboa?"), "pt");
  assert.equal(detectLanguage("Bom dia, gostaria de saber se o OpBritops se integra com o Shopify."), "pt");
  assert.equal(detectLanguage("Buenos días, quisiera saber si OpBritops se integra con Shopify."), "es");
});

test("candidates: a message that fits two languages names both, and never an unrelated one", () => {
  const c = candidateLanguages("Como funciona o OpBritops?");
  assert.ok(c.includes("pt") && c.includes("es"), c.join());
  assert.ok(!c.includes("en") && !c.includes("de"), c.join());
});

test("candidates: no evidence means no candidates (so nothing can be enforced)", () => {
  for (const t of ["OpBritops?", "xyzzy plugh", "Hoe werkt het product precies?", "ok", "😀"]) {
    assert.deepEqual(candidateLanguages(t), [], t);
  }
});

test("candidates: a clear message has its language among them", () => {
  assert.ok(candidateLanguages("Quanto costa al mese?").includes("it"));
  assert.ok(candidateLanguages("What can you do for me?").includes("en"));
});
