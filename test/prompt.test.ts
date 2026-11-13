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

// Live findings: asked which languages it speaks, the bot said "italiano, inglese, francese, portoghese, tedesco e
// italiano" (Spanish missing, Italian twice); and it told a user "no live search was performed".
test("prompt: the language list is always complete, and searches or live data are never mentioned", () => {
  assert.match(prompt, /list all six/i);
  assert.match(prompt, /never skip or repeat/i);
  assert.match(prompt, /never mention searching, browsing or live data/i);
});
