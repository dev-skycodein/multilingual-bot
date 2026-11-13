import { test } from "node:test";
import assert from "node:assert/strict";
import { languageListProblem } from "../src/guards/langlist.ts";
import { handleChat, messageFor } from "../src/chat.ts";
import { detectLanguage } from "../src/guards/language.ts";
import { fakeLlm, makeDeps } from "./helpers.ts";

// Live finding (2026-11-14): "Quali lingue parli?" was answered "Parlo italiano, inglese, francese, portoghese,
// tedesco e italiano." (Spanish missing, Italian twice). A list of languages must be exactly the six, once each.
test("language list: the wrong list from the live run is a problem", () => {
  assert.equal(languageListProblem("Parlo italiano, inglese, francese, portoghese, tedesco e italiano."), true);
});

test("language list: a correct list in each language is fine", () => {
  const ok = [
    "I support English, Spanish, French, Portuguese, German, and Italian.",
    "Parlo inglese, spagnolo, francese, portoghese, tedesco e italiano.",
    "Hablo inglés, español, francés, portugués, alemán e italiano.",
    "Je parle anglais, espagnol, français, portugais, allemand et italien.",
    "Eu falo inglês, espanhol, francês, português, alemão e italiano.",
    "Ich spreche Englisch, Spanisch, Französisch, Portugiesisch, Deutsch und Italienisch.",
  ];
  for (const t of ok) assert.equal(languageListProblem(t), false, t);
});

test("language list: lists with a missing or repeated language are problems", () => {
  assert.equal(languageListProblem("I support English, Spanish, French, Portuguese and German."), true);
  assert.equal(languageListProblem("Hablo inglés, español, francés, español, alemán e italiano."), true);
  assert.equal(languageListProblem("Ich spreche Englisch, Spanisch, Französisch und Deutsch."), true);
});

test("language list: ordinary replies that mention one or two languages are not touched", () => {
  for (const t of ["Parlo italiano e inglese.", "I can reply in English.", "Sorry, I only support six languages.", "Grazie! Posso aiutarti con OpBritops.", ""]) {
    assert.equal(languageListProblem(t), false, t);
  }
});

test("chat: a wrong language list from the model is replaced by the fixed correct list in the user's language", async () => {
  const llm = fakeLlm();
  llm.next = { kind: "text", text: "Parlo italiano, inglese, francese, portoghese, tedesco e italiano." };
  const { deps, logs } = makeDeps(llm);
  const r = await handleChat(deps, { sessionId: undefined, message: "Quali lingue parli?", clientKey: "t" });
  assert.equal(r.body.reply, messageFor("OpBritops", "languages", "it"));
  assert.match(r.body.reply, /spagnolo/);
  assert.equal(languageListProblem(r.body.reply), false, "the fixed list is itself a correct list");
  assert.ok(logs.includes("language_list_fixed"));
  assert.equal(llm.replyCalls.length, 1);
});

test("chat: a correct language list is passed through unchanged", async () => {
  const llm = fakeLlm();
  llm.next = { kind: "text", text: "Parlo inglese, spagnolo, francese, portoghese, tedesco e italiano." };
  const { deps } = makeDeps(llm);
  const r = await handleChat(deps, { sessionId: undefined, message: "Quali lingue parli?", clientKey: "t" });
  assert.equal(r.body.reply, "Parlo inglese, spagnolo, francese, portoghese, tedesco e italiano.");
});

test("fixed language list exists in all six languages and each is a correct list", () => {
  for (const l of ["en", "es", "fr", "pt", "de", "it"] as const) {
    const t = messageFor("OpBritops", "languages", l);
    assert.equal(languageListProblem(t), false, l);
    assert.equal(detectLanguage(t), l, `${l}: ${t}`);
  }
});

// Live finding: a short English reply ("Pleasure! 😊") to an Italian thanks was not recognised as English.
test("short everyday English replies are recognised as English", () => {
  for (const t of ["Pleasure! 😊", "You're welcome!", "Glad to help!", "Sorry about that."]) assert.equal(detectLanguage(t), "en", t);
});
