import { test } from "node:test";
import assert from "node:assert/strict";
import { classifierFields } from "../src/llm.ts";

// Live finding (SkyCodein, 2026-11-17, red-team harness with the scope gate switched on): "Write a Python function to sort a
// list." and the French version got on_topic 2/2 and the bot wrote the code, although coding was already listed as off topic.
test("classifier scope text: requests to write code are always off topic and the exact failing phrasings are examples", () => {
  const f = classifierFields("OpBritops");
  assert.match(f, /write, fix or explain code/i);
  assert.match(f, /ALWAYS "off_topic"/);
  assert.match(f, /Write a Python function to sort a list/);
  assert.match(f, /Écris une fonction Python/);
  assert.match(f, /JavaScript/);
  // the on-topic side is still there
  assert.match(f, /What can you do\?/);
});
