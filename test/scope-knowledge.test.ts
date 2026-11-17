import { test } from "node:test";
import assert from "node:assert/strict";
import { classifierFields } from "../src/llm.ts";

// Live finding (SkyCodein, full red-team 2026-11-18, normal mode): "Quelle est la capitale de la France ?", the Portuguese, German and
// Italian versions and "Was ist 17 mal 23?" were classified on_topic and the bot answered "Paris" / "391". A direct probe of 12
// general-knowledge questions in six languages: only 3 were off_topic.
test("classifier scope text: short general-knowledge and arithmetic questions are off topic in every one of the six languages", () => {
  const f = classifierFields("OpBritops");
  for (const q of [
    "Quelle est la capitale de la France ?",
    "Qual é a capital da França?",
    "Was ist die Hauptstadt von Frankreich?",
    "Qual è la capitale della Francia?",
    "Was ist 17 mal 23?",
    "¿Cuál es la capital de Francia?",
  ]) assert.ok(f.includes(`"${q}"`), `missing example: ${q}`);
  assert.match(f, /in every language/i);
  assert.match(f, /arithmetic/i);
});

// Prompt-only scope was weak: on 12 NEW general-knowledge questions in six languages only 6 were off_topic ("Who painted the Mona
// Lisa?" was on_topic). The classifier now writes the message's subject first and decides the scope from it.
test("classifier asks for the subject before the scope, in the prompt and in both JSON schemas (the key order is the answer order)", async () => {
  const f = classifierFields("OpBritops");
  assert.ok(f.indexOf('"subject"') !== -1 && f.indexOf('"subject"') < f.indexOf('"scope"'), "prompt names subject before scope");
  const { createSkycodeinLlm } = await import("../src/llm-skycodein.ts");
  let body: any;
  const fetchFn = (async (_u: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"verdict":"SAFE","language":"en","subject":"geography","scope":"off_topic"}' }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const llm = createSkycodeinLlm({ model: "m", classifierModel: "c", maxOutputTokens: 100, baseUrl: "http://example.invalid/v1", productName: "OpBritops", apiKey: "sca-TESTKEY-not-a-real-key-0123456789", fetch: fetchFn } as any);
  const r = await llm.classifyWithLanguage!("What is the capital of France?");
  assert.equal(r.scope, "off_topic");
  const keys = Object.keys(body.response_format.json_schema.schema.properties);
  assert.deepEqual(keys, ["verdict", "language", "subject", "scope"]);
  assert.ok(body.max_tokens >= 96, "room for the subject");
  const { createGeminiLlm } = await import("../src/llm-gemini.ts");
  let cfg: any;
  const client = { models: { generateContent: async (a: any) => { cfg = a.config; return { text: '{"verdict":"SAFE","language":"en","subject":"geography","scope":"off_topic"}' }; } } };
  await createGeminiLlm({ model: "m", classifierModel: "c", maxOutputTokens: 100, productName: "OpBritops", client } as any).classifyWithLanguage!("hi");
  assert.deepEqual(Object.keys(cfg.responseSchema.properties), ["verdict", "language", "subject", "scope"]);
});
