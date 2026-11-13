import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../src/prompt.ts";

const prompt = buildSystemPrompt("OpBritops", "CANARY-test");

test("prompt: identity rules - only the product's assistant, no model or vendor names, no privacy or security promises", () => {
  assert.match(prompt, /IDENTITY/);
  assert.match(prompt, /who or what you are/i);
  assert.match(prompt, /never name a model, a vendor or a provider/i);
  assert.match(prompt, /privacy, security, data storage or compliance/i);
});

// The SkyCodein API keeps only the newest messages that fit in 8000 characters (see llm-skycodein.ts).
test("prompt: stays short enough to leave room for the conversation", () => {
  assert.ok(prompt.length <= 3600, `prompt is ${prompt.length} characters`);
});
