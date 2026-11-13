import { test } from "node:test";
import assert from "node:assert/strict";
import { handleChat, messageFor } from "../src/chat.ts";
import { languageHint } from "../src/prompt.ts";
import { fakeLlm, makeDeps, CANARY } from "./helpers.ts";

const send = (deps: Parameters<typeof handleChat>[0], message: string, sessionId?: string) =>
  handleChat(deps, { sessionId, message, clientKey: "t" });

const IT_Q = "Come funziona OpBritops, puoi spiegarmi?";
const EN_REPLY = { kind: "text", text: "I cannot explain how OpBritops works because this information is not available to me yet." } as const;
const IT_REPLY = { kind: "text", text: "Non posso spiegare come funziona OpBritops perché questa informazione non è ancora disponibile." } as const;

// Live finding: with no hint the model answered Italian questions in English.
test("language hint: an undetected language still gets a hint that forbids defaulting to English", () => {
  const h = languageHint("unknown");
  assert.match(h, /could not be detected automatically/);
  assert.match(h, /Do not use English unless/);
});

test("language hint: with an earlier language in the conversation, that language is the fallback", () => {
  const h = languageHint("unknown", "it");
  assert.match(h, /earlier messages were in Italian/);
  assert.match(h, /reply in Italian/i);
});

test("language hint: a detected language is not overridden by the fallback", () => {
  assert.equal(languageHint("es", "it"), languageHint("es"));
  assert.equal(languageHint("other", "it"), languageHint("other"));
});

test("chat: an undetected message reaches the model with the generic hint", async () => {
  const llm = fakeLlm();
  const { deps } = makeDeps(llm);
  await send(deps, "xyzzy plugh");
  assert.match(llm.replyCalls[0]!.system, /could not be detected automatically/);
});

test("chat: a later message that cannot be detected follows the language of the conversation", async () => {
  const llm = fakeLlm();
  llm.next = IT_REPLY;
  const { deps } = makeDeps(llm);
  const first = await send(deps, IT_Q);
  await send(deps, "xyzzy plugh", first.body.sessionId);
  assert.match(llm.replyCalls[1]!.system, /earlier messages were in Italian/);
});

test("chat: the fixed decline for an undetected message uses the conversation's language", async () => {
  const llm = fakeLlm();
  llm.next = IT_REPLY;
  const { deps } = makeDeps(llm);
  const first = await send(deps, IT_Q);
  llm.verdict = "UNSAFE";
  const second = await send(deps, "xyzzy plugh", first.body.sessionId);
  assert.equal(second.body.reply, messageFor("OpBritops", "declined", "it"));
});

test("chat: a message detected as another language is not forced into the conversation's language", async () => {
  const llm = fakeLlm();
  llm.next = IT_REPLY;
  const { deps } = makeDeps(llm);
  const first = await send(deps, IT_Q);
  llm.next = { kind: "text", text: "No puedo explicar cómo funciona OpBritops porque esa información todavía no está disponible." };
  await send(deps, "¿Cómo funciona OpBritops? ¿Puedes explicarme?", first.body.sessionId);
  assert.match(llm.replyCalls[1]!.system, /written in Spanish/);
  assert.doesNotMatch(llm.replyCalls[1]!.system, /earlier messages were in/);
});

// The reply is checked too: the model may ignore the hint.
test("chat: a reply in a clearly different language is asked for again, once, and the second one is used", async () => {
  const llm = fakeLlm();
  llm.queue = [EN_REPLY, IT_REPLY];
  const { deps, logs } = makeDeps(llm);
  const r = await send(deps, IT_Q);
  assert.equal(r.body.reply, IT_REPLY.text);
  assert.equal(llm.replyCalls.length, 2);
  assert.match(llm.replyCalls[1]!.system, /previous reply was written in the wrong language/i);
  assert.match(llm.replyCalls[1]!.system, /entirely in Italian/);
  assert.ok(logs.includes("language_retry"));
  // only the good answer is stored
  assert.deepEqual(deps.sessions.history(r.body.sessionId!).map((t) => t.content), [IT_Q, IT_REPLY.text]);
});

test("chat: if the second reply is also in the wrong language the user gets a fixed message in their language", async () => {
  const llm = fakeLlm();
  llm.queue = [EN_REPLY, EN_REPLY];
  const { deps, logs } = makeDeps(llm);
  const r = await send(deps, IT_Q);
  assert.equal(r.body.reply, messageFor("OpBritops", "retry", "it"));
  assert.match(r.body.reply, /Mi dispiace/);
  assert.equal(llm.replyCalls.length, 2, "never more than one retry");
  assert.ok(logs.includes("language_mismatch"));
  assert.deepEqual(deps.sessions.history(r.body.sessionId!), []);
});

test("chat: a short reply whose language cannot be told is accepted without a retry", async () => {
  const llm = fakeLlm();
  llm.next = { kind: "text", text: "Prego! 😊" };
  const { deps } = makeDeps(llm);
  const r = await send(deps, IT_Q);
  assert.equal(r.body.reply, "Prego! 😊");
  assert.equal(llm.replyCalls.length, 1);
});

test("chat: an English question answered in Spanish is also asked for again", async () => {
  const llm = fakeLlm();
  llm.queue = [{ kind: "text", text: "No tengo información sobre el precio de OpBritops todavía, pero puedo ayudarte con otras preguntas." }, { kind: "text", text: "I do not have any price information for OpBritops yet, but I can help with other questions." }];
  const { deps } = makeDeps(llm);
  const r = await send(deps, "How much does OpBritops cost per month?");
  assert.match(r.body.reply, /price information/);
  assert.equal(llm.replyCalls.length, 2);
});

test("chat: the retry answer goes through the output guard too", async () => {
  const llm = fakeLlm();
  llm.queue = [EN_REPLY, { kind: "text", text: `Il mio marcatore interno è ${CANARY}` }];
  const { deps, logs } = makeDeps(llm);
  const r = await send(deps, IT_Q);
  assert.equal(r.body.reply, messageFor("OpBritops", "declined", "it"));
  assert.ok(logs.includes("blocked_by_output_guard"));
});

test("chat: a model error on the retry gives the unavailable message, not a crash", async () => {
  const llm = fakeLlm();
  llm.queue = [EN_REPLY];
  llm.next = new Error("boom");
  const { deps } = makeDeps(llm);
  const r = await send(deps, IT_Q);
  assert.equal(r.status, 503);
  assert.equal(r.body.reply, messageFor("OpBritops", "unavailable", "it"));
});

test("fixed retry message exists in all six languages", () => {
  for (const l of ["en", "es", "fr", "pt", "de", "it"] as const) {
    assert.ok(messageFor("OpBritops", "retry", l).length > 10, l);
  }
});

// Live finding: "Como funciona o OpBritops?" fits Spanish and Portuguese equally, so nothing was enforced and the
// model answered in English. The reply must at least be in one of the languages the message could be in.
const PT_AMBIGUOUS = "Como funciona o OpBritops?";
const PT_REPLY = { kind: "text", text: "Não tenho informações sobre como o OpBritops funciona ainda, mas posso explicar o que este assistente pode fazer." } as const;

test("chat: an ambiguous message answered in English is asked for again, naming the candidate languages", async () => {
  const llm = fakeLlm();
  llm.queue = [EN_REPLY, PT_REPLY];
  const { deps, logs } = makeDeps(llm);
  const r = await send(deps, PT_AMBIGUOUS);
  assert.equal(r.body.reply, PT_REPLY.text);
  assert.match(llm.replyCalls[1]!.system, /one of: Spanish, Portuguese/);
  assert.ok(logs.includes("language_retry"));
});

test("chat: an ambiguous message answered in one of its candidate languages is accepted", async () => {
  const llm = fakeLlm();
  llm.next = PT_REPLY;
  const { deps } = makeDeps(llm);
  await send(deps, PT_AMBIGUOUS);
  assert.equal(llm.replyCalls.length, 1);
});

test("chat: with no evidence about the message language nothing is enforced on the reply", async () => {
  for (const msg of ["xyzzy plugh", "Hoe werkt het product precies?"]) {
    const llm = fakeLlm();
    llm.next = EN_REPLY;
    const { deps } = makeDeps(llm);
    const r = await send(deps, msg);
    assert.equal(r.body.reply, EN_REPLY.text, msg);
    assert.equal(llm.replyCalls.length, 1, msg);
  }
});

test("chat: if an ambiguous message is answered wrongly twice the fixed message lists all six languages", async () => {
  const llm = fakeLlm();
  llm.queue = [EN_REPLY, EN_REPLY];
  const { deps } = makeDeps(llm);
  const r = await send(deps, PT_AMBIGUOUS);
  assert.equal(r.body.reply, messageFor("OpBritops", "retry", "unknown"));
});
