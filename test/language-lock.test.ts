import { test } from "node:test";
import assert from "node:assert/strict";
import { handleChat, messageFor } from "../src/chat.ts";
import { requestedLanguage, resolveLanguage as resolve, wordCount } from "../src/guards/langlock.ts";
import { fakeLlm, makeDeps } from "./helpers.ts";

// The user's rule: whatever language the user starts in, ALL replies (answers, declines, off-topic, retry, busy) stay in it
// until the USER changes language, either by writing a real message in another language or by asking for one.

const send = (deps: Parameters<typeof handleChat>[0], message: string, sessionId?: string) =>
  handleChat(deps, { sessionId, message, clientKey: "t" });

const IT_Q = "Ciao, cosa puoi fare per me?";
const DE_Q = "Hallo, was kannst du für mich tun?";
const IT_REPLY = { kind: "text", text: "Posso aiutarti con le domande su OpBritops, per esempio sulle sue funzioni generali." } as const;
const DE_REPLY = { kind: "text", text: "Ich kann Ihnen bei Fragen zu OpBritops helfen, zum Beispiel zu den allgemeinen Funktionen." } as const;
const EN_REPLY = { kind: "text", text: "I can help you with questions about OpBritops, for example about its general features." } as const;

// ---- requestedLanguage -------------------------------------------------------------------------------------------

test("requestedLanguage: finds an explicit request to continue in one of the six, in every language", () => {
  assert.equal(requestedLanguage("Please answer in English"), "en");
  assert.equal(requestedLanguage("Antworte bitte auf Englisch."), "en");
  assert.equal(requestedLanguage("Responde en español por favor"), "es");
  assert.equal(requestedLanguage("Réponds-moi en français"), "fr");
  assert.equal(requestedLanguage("Responda em português, por favor"), "pt");
  assert.equal(requestedLanguage("Rispondi in italiano"), "it");
  assert.equal(requestedLanguage("ab French me baat karo"), "fr");
  assert.equal(requestedLanguage("Can we switch to German?"), "de");
  assert.equal(requestedLanguage("In English, please"), "en");
});

test("requestedLanguage: a translation job, a question about languages, or an unsupported language is not a request", () => {
  assert.equal(requestedLanguage("Traduci in francese: 'buongiorno, come stai?'"), undefined);
  assert.equal(requestedLanguage("Translate good morning into German"), undefined);
  assert.equal(requestedLanguage("Which languages do you speak?"), undefined);
  assert.equal(requestedLanguage("Do you speak English?"), undefined);
  assert.equal(requestedLanguage("Answer in Urdu please"), undefined);
  assert.equal(requestedLanguage("What does 'in English' mean for my account settings?"), undefined);
});

// Only the language and what is saved are compared here; the source only words the hint (checked in the chat tests).
const resolveLanguage = (o: Parameters<typeof resolve>[0]) => {
  const { lang, save } = resolve(o);
  return save ? { lang, save } : { lang };
};

// ---- resolveLanguage ---------------------------------------------------------------------------------------------

test("wordCount: counts letter words, not punctuation or digits", () => {
  assert.equal(wordCount("ok"), 1);
  assert.equal(wordCount("e poi?"), 2);
  assert.equal(wordCount("Ciao, cosa puoi fare?"), 4);
  assert.equal(wordCount("123 !!"), 0);
});

test("resolveLanguage: a short message never breaks the lock, even when the detector or classifier is 'sure'", () => {
  assert.deepEqual(resolveLanguage({ text: "Okay", detected: "en", sticky: "de" }), { lang: "de" });
  assert.deepEqual(resolveLanguage({ text: "ok", detected: "unknown", modelLang: "en", sticky: "it" }), { lang: "it" });
  assert.deepEqual(resolveLanguage({ text: "no", detected: "en", sticky: "fr" }), { lang: "fr" });
});

test("resolveLanguage: a real message in another language changes the language and is saved", () => {
  const r = resolveLanguage({ text: "Actually, can you explain that in more detail please?", detected: "en", sticky: "it" });
  assert.deepEqual(r, { lang: "en", save: "en" });
});

test("resolveLanguage: the classifier's language is a guess: saved only as the first evidence of a real message, never over a lock", () => {
  // No lock yet: used; saved only when the message is 3+ words.
  assert.deepEqual(resolveLanguage({ text: "xyzzy plugh quux", detected: "unknown", modelLang: "fr", sticky: undefined }), { lang: "fr", save: "fr" });
  assert.deepEqual(resolveLanguage({ text: "xyzzy plugh", detected: "unknown", modelLang: "fr", sticky: undefined }), { lang: "fr" });
  // With a lock: a supported language from the classifier never beats it ("ok" -> "en" is the bug), "other" can for a real message.
  assert.deepEqual(resolveLanguage({ text: "xyzzy plugh quux", detected: "unknown", modelLang: "fr", sticky: "it" }), { lang: "it" });
  assert.deepEqual(resolveLanguage({ text: "ok", detected: "unknown", modelLang: "en", sticky: "it" }), { lang: "it" });
  assert.deepEqual(resolveLanguage({ text: "xyzzy plugh quux", detected: "unknown", modelLang: "other", sticky: "it" }), { lang: "other" });
  assert.deepEqual(resolveLanguage({ text: "xyzzy", detected: "unknown", modelLang: "other", sticky: "it" }), { lang: "it" });
});

test("resolveLanguage: an explicit request wins and is saved; the first message is saved when the detector is sure", () => {
  assert.deepEqual(resolveLanguage({ text: "Antworte bitte auf Englisch.", detected: "de", sticky: "de" }), { lang: "en", save: "en" });
  assert.deepEqual(resolveLanguage({ text: "Hola", detected: "es", sticky: undefined }), { lang: "es", save: "es" });
  assert.deepEqual(resolveLanguage({ text: "Hola", detected: "unknown", sticky: undefined }), { lang: "unknown" });
});

test("resolveLanguage: a non-Latin-script message is 'other' (English reply) and does not erase the lock", () => {
  assert.deepEqual(resolveLanguage({ text: "آپ کیا کر سکتے ہیں", detected: "other", sticky: "it" }), { lang: "other" });
});

// ---- chat --------------------------------------------------------------------------------------------------------

test("chat: short follow-ups keep the language even when the classifier says 'en' and the detector is sure of English", async () => {
  const llm = fakeLlm();
  llm.next = DE_REPLY;
  llm.language = "en";
  const { deps, logs } = makeDeps(llm);
  const first = await send(deps, DE_Q);
  for (const word of ["Okay", "ok", "Team", "Information"]) {
    const r = await send(deps, word, first.body.sessionId);
    assert.equal(r.body.reply, DE_REPLY.text, word);
  }
  // The model was told German each time and never asked to retry.
  for (const call of llm.replyCalls.slice(1)) assert.match(call.system, /conversation is in German/);
  assert.ok(!logs.includes("language_retry"));
  assert.equal(deps.sessions.language(first.body.sessionId!), "de");
});

test("chat: a classifier guess is never saved as the conversation's language", async () => {
  const llm = fakeLlm();
  llm.next = IT_REPLY;
  const { deps } = makeDeps(llm);
  const first = await send(deps, IT_Q);
  llm.language = "en";
  await send(deps, "ok", first.body.sessionId);
  await send(deps, "Hotel", first.body.sessionId);
  assert.equal(deps.sessions.language(first.body.sessionId!), "it");
  assert.match(llm.replyCalls[2]!.system, /conversation is in Italian/);
});

test("chat: the user really switching language by writing is followed and then kept", async () => {
  const llm = fakeLlm();
  llm.next = IT_REPLY;
  const { deps } = makeDeps(llm);
  const first = await send(deps, IT_Q);
  llm.next = EN_REPLY;
  const second = await send(deps, "Actually, can you explain that in more detail please?", first.body.sessionId);
  assert.equal(second.body.reply, EN_REPLY.text);
  await send(deps, "ok", first.body.sessionId);
  assert.match(llm.replyCalls[2]!.system, /conversation is in English/);
});

test("chat: 'answer in English' written in German switches to English, and it stays English", async () => {
  const llm = fakeLlm();
  llm.next = DE_REPLY;
  const { deps, logs } = makeDeps(llm);
  const first = await send(deps, DE_Q);
  llm.next = EN_REPLY;
  const second = await send(deps, "Antworte bitte auf Englisch.", first.body.sessionId);
  assert.equal(second.body.reply, EN_REPLY.text);
  assert.match(llm.replyCalls[1]!.system, /asked to continue in English/);
  assert.ok(!logs.includes("language_retry"));
  await send(deps, "Und jetzt?", first.body.sessionId);
  assert.match(llm.replyCalls[2]!.system, /conversation is in English/);
});

test("chat: a message that only asks for a translation does not change the language", async () => {
  const llm = fakeLlm();
  llm.next = IT_REPLY;
  const { deps } = makeDeps(llm);
  const first = await send(deps, IT_Q);
  await send(deps, "Traduci in francese: 'buongiorno, come stai?'", first.body.sessionId);
  assert.equal(deps.sessions.language(first.body.sessionId!), "it");
  assert.match(llm.replyCalls[1]!.system, /Italian/);
});

test("chat: an off-topic or declined FIRST message still sets the language for what follows", async () => {
  const llm = fakeLlm();
  llm.scope = "off_topic";
  const { deps } = makeDeps(llm);
  const first = await send(deps, "Scrivimi un saggio sulla fotosintesi, per favore");
  assert.equal(first.body.reply, messageFor("OpBritops", "offtopic", "it"));
  llm.scope = "on_topic";
  llm.language = "en";
  llm.next = IT_REPLY;
  await send(deps, "ok", first.body.sessionId);
  assert.match(llm.replyCalls[0]!.system, /conversation is in Italian/);
});

test("chat: fixed declines for short messages stay in the conversation's language", async () => {
  const llm = fakeLlm();
  llm.next = DE_REPLY;
  llm.language = "en";
  const { deps } = makeDeps(llm);
  const first = await send(deps, DE_Q);
  llm.verdict = "UNSAFE";
  const r = await send(deps, "Okay", first.body.sessionId);
  assert.equal(r.body.reply, messageFor("OpBritops", "declined", "de"));
});

test("chat: busy and invalid-input messages use the conversation's language, not all six", async () => {
  const llm = fakeLlm();
  llm.next = IT_REPLY;
  const { deps } = makeDeps(llm, { ratePerMinute: 2 });
  const first = await send(deps, IT_Q);
  const invalid = await send(deps, "", first.body.sessionId);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.reply, messageFor("OpBritops", "invalid", "it"));
  const busy = await send(deps, "Ciao ancora una volta", first.body.sessionId);
  assert.equal(busy.status, 429);
  assert.equal(busy.body.reply, messageFor("OpBritops", "busy", "it"));
});

test("chat: busy for a client with no session still lists all six", async () => {
  const llm = fakeLlm();
  const { deps } = makeDeps(llm, { ratePerMinute: 1 });
  await send(deps, IT_Q);
  const busy = await send(deps, IT_Q);
  assert.equal(busy.status, 429);
  assert.equal(busy.body.reply.split("\n").length, 6);
});

test("chat: the retry after a wrong-language reply keeps the locked language and the fixed text is in it", async () => {
  const llm = fakeLlm();
  llm.next = DE_REPLY;
  llm.language = "en";
  const { deps, logs } = makeDeps(llm);
  const first = await send(deps, DE_Q);
  llm.queue = [EN_REPLY, EN_REPLY];
  const r = await send(deps, "Okay", first.body.sessionId);
  assert.ok(logs.includes("language_retry"));
  assert.match(llm.replyCalls[2]!.system, /entirely in German/);
  assert.equal(r.body.reply, messageFor("OpBritops", "retry", "de"));
});

test("chat: a reply in a script outside the six (Urdu to an Urdu message) is caught: retried, then a fixed English text", async () => {
  const llm = fakeLlm();
  const urdu = { kind: "text", text: "میں آپ کی مدد کر سکتا ہوں، آپ کیا جاننا چاہتے ہیں" } as const;
  llm.next = urdu;
  const { deps, logs } = makeDeps(llm);
  const r = await send(deps, "آپ کیا کر سکتے ہیں؟");
  assert.ok(logs.includes("language_retry"));
  assert.ok(logs.includes("language_mismatch"));
  // A user of an unsupported language gets the rule's answer: English, and the six languages we do support.
  assert.equal(r.body.reply, messageFor("OpBritops", "languages", "en"));
});

// Live finding (SkyCodein, full red-team 2026-11-18): Arabic and Chinese greetings ended in "Sorry, I couldn't answer that properly" and a
// Hindi greeting in the six-line "I can't follow that request": the rule is "reply in English and say which six languages are supported".
test("unsupported language: a refusal from the model (first or after the retry) also gets the English list of the six languages", async () => {
  const hindi = "नमस्ते, आप क्या कर सकते हैं?";
  const first = fakeLlm();
  first.next = { kind: "refusal" };
  assert.equal((await send(makeDeps(first).deps, hindi)).body.reply, messageFor("OpBritops", "languages", "en"));
  const retry = fakeLlm();
  retry.queue = [{ kind: "text", text: "नमस्ते! मैं आपकी मदद कर सकता हूँ, आप क्या जानना चाहते हैं" }, { kind: "refusal" }];
  assert.equal((await send(makeDeps(retry).deps, hindi)).body.reply, messageFor("OpBritops", "languages", "en"));
});

test("supported languages are unaffected: a refusal or a failed retry still uses that language's own fixed text", async () => {
  const it = fakeLlm();
  it.next = { kind: "refusal" };
  assert.equal((await send(makeDeps(it).deps, "Ciao, cosa puoi fare per me?")).body.reply, messageFor("OpBritops", "declined", "it"));
});

test("chat: an Urdu-script message gets an English reply when the retry fixes the language", async () => {
  const llm = fakeLlm();
  const urdu = { kind: "text", text: "میں آپ کی مدد کر سکتا ہوں، آپ کیا جاننا چاہتے ہیں" } as const;
  llm.queue = [urdu, EN_REPLY];
  const { deps } = makeDeps(llm);
  const r = await send(deps, "آپ کیا کر سکتے ہیں؟");
  assert.equal(r.body.reply, EN_REPLY.text);
});
