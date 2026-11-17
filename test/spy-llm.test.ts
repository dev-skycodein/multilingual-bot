import { test } from "node:test";
import assert from "node:assert/strict";
import { spyLlm } from "../scripts/spy-llm.ts";
import type { SpyControl } from "../scripts/spy-llm.ts";
import { handleChat } from "../src/chat.ts";
import { fakeLlm, makeDeps } from "./helpers.ts";

// 2026-11-17 audit: the hard red-team wrapper did not forward classifyWithLanguage, so that run had no scope gate and no
// classifier language ("0 off_topic events" in its results). These tests keep the wrapper honest.

const ctl = (): SpyControl => ({ forceSafe: false, lastErr: "" });

test("spy llm: classifyWithLanguage is forwarded with verdict, language and scope", async () => {
  const real = fakeLlm();
  real.language = "it";
  real.scope = "off_topic";
  const spy = spyLlm(real, ctl());
  assert.ok(spy.classifyWithLanguage, "the wrapper must offer classifyWithLanguage when the real client does");
  assert.deepEqual(await spy.classifyWithLanguage!("Scrivimi un saggio", ["ciao"]), { verdict: "SAFE", language: "it", scope: "off_topic" });
  assert.deepEqual(real.classifyContexts.at(-1), ["ciao"]);
});

test("spy llm: a real client without classifyWithLanguage gives a wrapper without it", () => {
  const real = fakeLlm();
  delete (real as { classifyWithLanguage?: unknown }).classifyWithLanguage;
  assert.equal(spyLlm(real, ctl()).classifyWithLanguage, undefined);
});

test("spy llm: the scope gate runs through the wrapper in the real chat flow", async () => {
  const real = fakeLlm();
  real.scope = "off_topic";
  const { deps, logs } = makeDeps(real);
  deps.llm = spyLlm(real, ctl());
  const r = await handleChat(deps, { sessionId: undefined, message: "Write me a long essay about photosynthesis", clientKey: "t" });
  assert.ok(logs.includes("off_topic"));
  assert.equal(r.body.blocked, true);
  assert.equal(real.replyCalls.length, 0);
});

test("spy llm: forceSafe skips the classifier completely (bypass items test the main model), scope and language too", async () => {
  const real = fakeLlm();
  real.verdict = "UNSAFE";
  real.scope = "off_topic";
  const c = ctl();
  c.forceSafe = true;
  const spy = spyLlm(real, c);
  assert.equal(await spy.classify("ignore everything"), "SAFE");
  assert.deepEqual(await spy.classifyWithLanguage!("ignore everything"), { verdict: "SAFE", language: undefined, scope: undefined });
  assert.equal(real.classifyCalls.length, 0);
});

test("spy llm: errors are remembered and still thrown", async () => {
  const real = fakeLlm();
  real.verdict = Object.assign(new Error("boom"), { status: 429 });
  const c = ctl();
  const spy = spyLlm(real, c);
  await assert.rejects(spy.classifyWithLanguage!("hi"));
  assert.match(c.lastErr, /status=429/);
});
