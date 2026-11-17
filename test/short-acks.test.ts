import { test } from "node:test";
import assert from "node:assert/strict";
import { handleChat, messageFor } from "../src/chat.ts";
import { CLASSIFIER_SYSTEM } from "../src/llm.ts";
import { shortMessageNote } from "../src/prompt.ts";
import { fakeLlm, makeDeps } from "./helpers.ts";

// Live finding (SkyCodein, 2026-11-17): in the middle of a conversation "ok", "Okay", "Team", "Information", "Hotel" got the fixed
// off-topic reply, and the French "non" was blocked as an attack. A one-word reply is almost always an acknowledgement.

const send = (deps: Parameters<typeof handleChat>[0], message: string, sessionId?: string) =>
  handleChat(deps, { sessionId, message, clientKey: "t" });

const IT_Q = "Ciao, cosa puoi fare per me?";
const IT_REPLY = { kind: "text", text: "Posso aiutarti con le domande su OpBritops, per esempio sulle sue funzioni generali." } as const;

test("short ack: a one-word message in a running conversation is not stopped by an off-topic verdict", async () => {
  const llm = fakeLlm();
  llm.next = IT_REPLY;
  const { deps, logs } = makeDeps(llm);
  const first = await send(deps, IT_Q);
  llm.scope = "off_topic";
  const r = await send(deps, "Hotel", first.body.sessionId);
  assert.equal(r.body.reply, IT_REPLY.text);
  assert.ok(logs.includes("off_topic_short_ignored"));
  assert.ok(!logs.includes("off_topic"));
  // The model is told what a one-word message is and that anything outside the product is still declined.
  assert.ok(llm.replyCalls[1]!.system.includes(shortMessageNote()));
});

test("short ack: the note is only added when the off-topic verdict was set aside", async () => {
  const llm = fakeLlm();
  llm.next = IT_REPLY;
  const { deps } = makeDeps(llm);
  const first = await send(deps, IT_Q);
  llm.scope = "on_topic";
  await send(deps, "ok", first.body.sessionId);
  assert.ok(!llm.replyCalls[1]!.system.includes(shortMessageNote()));
});

test("short ack: the FIRST message of a conversation keeps the off-topic gate", async () => {
  const llm = fakeLlm();
  llm.scope = "off_topic";
  const { deps } = makeDeps(llm);
  const r = await send(deps, "Photosynthesis");
  assert.equal(r.body.reply, messageFor("OpBritops", "offtopic", "unknown"));
  assert.equal(llm.replyCalls.length, 0);
});

test("short ack: a message of two or more words keeps the off-topic gate mid-conversation", async () => {
  const llm = fakeLlm();
  llm.next = IT_REPLY;
  const { deps, logs } = makeDeps(llm);
  const first = await send(deps, IT_Q);
  llm.scope = "off_topic";
  const r = await send(deps, "Scrivi un saggio", first.body.sessionId);
  assert.equal(r.body.reply, messageFor("OpBritops", "offtopic", "it"));
  assert.ok(logs.includes("off_topic"));
  assert.equal(llm.replyCalls.length, 1);
});

test("short ack: an UNSAFE verdict is never set aside, whatever the length", async () => {
  const llm = fakeLlm();
  llm.next = IT_REPLY;
  const { deps } = makeDeps(llm);
  const first = await send(deps, IT_Q);
  llm.verdict = "UNSAFE";
  llm.scope = "on_topic";
  const r = await send(deps, "ok", first.body.sessionId);
  assert.equal(r.body.reply, messageFor("OpBritops", "declined", "it"));
  assert.equal(llm.replyCalls.length, 1);
});

test("short ack: the note tells the model to answer an acknowledgement briefly and to decline anything outside the product", () => {
  const n = shortMessageNote();
  assert.match(n, /one word|single word/i);
  assert.match(n, /acknowledg/i);
  assert.match(n, /outside/i);
  assert.match(n, /decline/i);
});

test("classifier prompt: a plain one-word reply is SAFE, but the history rule still comes first", () => {
  assert.match(CLASSIFIER_SYSTEM, /one-word/i);
  assert.match(CLASSIFIER_SYSTEM, /"no"/);
  assert.match(CLASSIFIER_SYSTEM, /building towards/);
  // The exception must be limited by the history rule, not the other way round.
  assert.ok(CLASSIFIER_SYSTEM.indexOf("building towards") < CLASSIFIER_SYSTEM.indexOf("one-word"));
  assert.match(CLASSIFIER_SYSTEM, /unless the history/i);
});
