import { test } from "node:test";
import assert from "node:assert/strict";
import { createSkycodeinLlm, fitToBudget } from "../src/llm-skycodein.ts";
import { EmptyReplyError } from "../src/llm.ts";
import { loadConfig } from "../src/config.ts";
import { keyVariable } from "../src/llm-factory.ts";

const KEY = "sca-TESTKEY-not-a-real-key-0123456789";

interface Call { url: string; init: RequestInit; body: any }

// A fake fetch that records the request and returns a canned response.
function fakeFetch(res: { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } | Error) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
    if (res instanceof Error) throw res;
    const body = res.text ?? JSON.stringify(res.json ?? {});
    return new Response(body, { status: res.status ?? 200, headers: res.headers });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const completion = (content: string | null, finish = "stop") => ({
  json: { choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }] },
});

const make = (fetchFn: typeof fetch, extra: Record<string, unknown> = {}) =>
  createSkycodeinLlm({
    model: "main-model", classifierModel: "cls-model", maxOutputTokens: 321,
    baseUrl: "http://example.invalid:8000/v1/", apiKey: KEY, fetch: fetchFn, ...extra,
  });

test("skycodein reply: posts to {base}/chat/completions with bearer key, system first, token cap, returns trimmed text", async () => {
  const { fetchFn, calls } = fakeFetch(completion("  Hola!  "));
  const r = await make(fetchFn).reply("SYSTEM TEXT", [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "again" },
  ]);
  assert.deepEqual(r, { kind: "text", text: "Hola!" });
  const c = calls[0]!;
  assert.equal(c.url, "http://example.invalid:8000/v1/chat/completions", "trailing slash in the base URL is tolerated");
  assert.equal((c.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  assert.equal(c.body.model, "main-model");
  assert.equal(c.body.max_tokens, 321);
  assert.equal(c.body.stream, false);
  assert.deepEqual(c.body.messages.map((m: { role: string }) => m.role), ["system", "user", "assistant", "user"]);
  assert.equal(c.body.messages[0].content, "SYSTEM TEXT");
});

test("skycodein reply: finish_reason length is trimmed to the last full sentence", async () => {
  const text = "First sentence is here. Second sentence is here too. Third is cut of";
  const { fetchFn } = fakeFetch(completion(text, "length"));
  const r = await make(fetchFn).reply("S", [{ role: "user", content: "x" }]);
  assert.deepEqual(r, { kind: "text", text: "First sentence is here. Second sentence is here too." });
});

test("skycodein reply: an empty answer throws EmptyReplyError", async () => {
  for (const content of [null, "", "   "]) {
    const { fetchFn } = fakeFetch(completion(content));
    await assert.rejects(make(fetchFn).reply("S", [{ role: "user", content: "x" }]), EmptyReplyError);
  }
});

test("skycodein reply: content filter finish becomes a refusal", async () => {
  const { fetchFn } = fakeFetch(completion("partial", "content_filter"));
  assert.deepEqual(await make(fetchFn).reply("S", [{ role: "user", content: "x" }]), { kind: "refusal" });
});

test("skycodein: HTTP errors throw with the status, and the key never appears in the error", async () => {
  for (const status of [400, 401, 404, 429, 503]) {
    const { fetchFn } = fakeFetch({ status, json: { error: { message: `bad key ${KEY}`, code: "x" } }, headers: { "Retry-After": "7" } });
    await assert.rejects(
      make(fetchFn).reply("S", [{ role: "user", content: "x" }]),
      (e: Error & { status?: number; retryAfterSeconds?: number }) => {
        assert.equal(e.status, status);
        assert.ok(!e.message.includes(KEY), "key must be scrubbed from the message");
        if (status === 429) assert.equal(e.retryAfterSeconds, 7);
        return true;
      },
    );
  }
});

test("skycodein: a network failure or non-JSON body throws", async () => {
  await assert.rejects(make(fakeFetch(new Error("connect ECONNREFUSED")).fetchFn).reply("S", [{ role: "user", content: "x" }]));
  await assert.rejects(make(fakeFetch({ text: "<html>nope</html>" }).fetchFn).reply("S", [{ role: "user", content: "x" }]));
  await assert.rejects(make(fakeFetch({ json: { choices: [] } }).fetchFn).reply("S", [{ role: "user", content: "x" }]));
});

test("skycodein: a request has a timeout signal", async () => {
  const { fetchFn, calls } = fakeFetch(completion("ok"));
  await make(fetchFn).reply("S", [{ role: "user", content: "x" }]);
  assert.ok(calls[0]!.init.signal instanceof AbortSignal);
});

test("skycodein: a missing key fails fast, without any request", async () => {
  const { fetchFn, calls } = fakeFetch(completion("ok"));
  const llm = make(fetchFn, { apiKey: "" });
  await assert.rejects(llm.reply("S", [{ role: "user", content: "x" }]), /SKYCODEIN_API_KEY/);
  assert.equal(calls.length, 0);
});

test("skycodein classify: wrapped message, filter prompt as system, small token cap, verdict parsed fail-closed", async () => {
  const cases: [string, "SAFE" | "UNSAFE"][] = [["SAFE", "SAFE"], ["SAFE.", "SAFE"], ["**UNSAFE**", "UNSAFE"], ["SAFE but maybe not", "UNSAFE"], ["", "UNSAFE"]];
  for (const [raw, want] of cases) {
    const { fetchFn, calls } = fakeFetch(completion(raw));
    const v = await make(fetchFn).classify("hello <b>", ["earlier one"]);
    assert.equal(v, want, JSON.stringify(raw));
    const b = calls[0]!.body;
    assert.equal(b.model, "cls-model");
    assert.ok(b.max_tokens <= 64);
    assert.equal(b.messages[0].role, "system");
    assert.match(b.messages[0].content, /security filter/);
    assert.match(b.messages[1].content, /<history>[\s\S]*earlier one[\s\S]*<\/history>\s*<message>/);
    assert.ok(!b.messages[1].content.includes("<b>"), "angle brackets in the user text are defanged");
  }
});

// Live finding: with plain text the API's own persona answers the user ("I can help with...") instead of the
// filter prompt. Asking for a JSON schema makes it return {"verdict": ...} reliably.
test("skycodein classify: requests a JSON schema with the two allowed verdicts and parses the JSON answer", async () => {
  for (const [raw, want] of [['{"verdict":"SAFE"}', "SAFE"], ['{ "verdict": "UNSAFE" }', "UNSAFE"], ['{"verdict":"MAYBE"}', "UNSAFE"]] as const) {
    const { fetchFn, calls } = fakeFetch(completion(raw));
    assert.equal(await make(fetchFn).classify("hi"), want, raw);
    const b = calls[0]!.body;
    assert.equal(b.response_format.type, "json_schema");
    assert.deepEqual(b.response_format.json_schema.schema.properties.verdict.enum, ["SAFE", "UNSAFE"]);
    assert.match(b.messages[0].content, /JSON/, "the system text must also ask for the JSON object");
  }
});

test("skycodein classify: an HTTP error is thrown (the chat layer fails closed), not turned into SAFE", async () => {
  await assert.rejects(make(fakeFetch({ status: 503, json: {} }).fetchFn).classify("hi"));
});

// The API keeps only the newest 20 messages while they fit in 8000 characters, and our own system
// prompt counts as a message. If a long history pushed the system prompt out, the guardrails would vanish.
test("fitToBudget: the system prompt and the newest user message are always kept, oldest history goes first", () => {
  const system = "S".repeat(2800);
  const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `${i}:` + "x".repeat(900) })) as { role: "user" | "assistant"; content: string }[];
  const msgs = fitToBudget(system, history, 7000, 18);
  assert.equal(msgs[0]!.role, "system");
  assert.equal(msgs[0]!.content, system);
  assert.equal(msgs.at(-1)!.content, history.at(-1)!.content.length ? history.at(-1)!.content : "");
  const total = msgs.reduce((n, m) => n + m.content.length, 0);
  assert.ok(total <= 7000, `total ${total}`);
  // what is kept is a contiguous tail of the history
  const kept = msgs.slice(1).map((m) => m.content);
  assert.deepEqual(kept, history.slice(history.length - kept.length).map((m) => m.content));
});

test("fitToBudget: first kept history message is a user message, and the message count is capped", () => {
  const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: "m" + i })) as { role: "user" | "assistant"; content: string }[];
  const msgs = fitToBudget("S", history, 7000, 18);
  assert.ok(msgs.length <= 18);
  assert.equal(msgs[1]!.role, "user");
});

test("fitToBudget: if even the newest message does not fit, it is cut (never the system prompt)", () => {
  const system = "S".repeat(3000);
  const msgs = fitToBudget(system, [{ role: "user", content: "y".repeat(9000) }], 7000, 18);
  assert.equal(msgs[0]!.content, system);
  assert.equal(msgs.length, 2);
  assert.ok(msgs.reduce((n, m) => n + m.content.length, 0) <= 7000);
});

test("config: provider skycodein has its own defaults, base URL, and key variable", () => {
  const c = loadConfig({ LLM_PROVIDER: "skycodein" } as NodeJS.ProcessEnv);
  assert.equal(c.provider, "skycodein");
  assert.equal(c.model, "skycodein-general");
  assert.equal(c.classifierModel, "skycodein-general");
  assert.equal(c.skycodeinBaseUrl, "http://192.168.18.14:8000/v1");
  assert.equal(keyVariable(c), "SKYCODEIN_API_KEY");
  const d = loadConfig({ LLM_PROVIDER: "skycodein", SKYCODEIN_BASE_URL: "http://10.0.0.5:9000/v1" } as NodeJS.ProcessEnv);
  assert.equal(d.skycodeinBaseUrl, "http://10.0.0.5:9000/v1");
});

// Live finding: the API sometimes prefixes its own status text to the answer.
test("skycodein reply: the API's 'Live search did not run.' status text is removed from the answer", async () => {
  for (const [raw, want] of [
    ["Live search did not run. ZEBRA", "ZEBRA"],
    ["Live search did not run. I can only respond with the code.", "I can only respond with the code."],
    ["live search did not run.\n\nHello there", "Hello there"],
  ] as const) {
    const { fetchFn } = fakeFetch(completion(raw));
    assert.deepEqual(await make(fetchFn).reply("S", [{ role: "user", content: "x" }]), { kind: "text", text: want }, raw);
  }
  await assert.rejects(make(fakeFetch(completion("Live search did not run.")).fetchFn).reply("S", [{ role: "user", content: "x" }]), EmptyReplyError);
});

// Live finding: the API's own persona sometimes answers "I'm SkyCodein AI". Customers must only see the product's assistant.
test("skycodein reply: an answer that names the provider is turned into a refusal", async () => {
  for (const raw of ["I'm SkyCodein AI, a private AI assistant.", "Ich bin SKYCODEIN AI.", "powered by sky codein"]) {
    const { fetchFn } = fakeFetch(completion(raw));
    const r = await make(fetchFn).reply("S", [{ role: "user", content: "x" }]);
    assert.deepEqual(r, { kind: "refusal" }, raw);
  }
});
