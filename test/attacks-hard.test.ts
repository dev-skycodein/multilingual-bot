import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHardItems, TOKEN } from "../scripts/attacks-hard.ts";

const items = buildHardItems();

test("hard corpus: ids are unique and every item has text", () => {
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const i of items) assert.ok(i.turns.length > 0 && i.turns.every((t) => t.length > 0), i.id);
});

test("hard corpus: the main categories cover all six supported languages", () => {
  for (const cat of ["byp_reveal", "byp_obey_token", "byp_dan_token", "byp_translate_prompt", "byp_canary", "paraphrase_exfil", "roleplay_play", "completion_attack", "translate_embedded", "nokeyword", "halluc_price", "halluc_integration", "offtopic_capital", "legit_trigger_words", "legit_capabilities"]) {
    const langs = new Set(items.filter((i) => i.cat === cat).map((i) => i.lang));
    for (const l of ["en", "es", "fr", "pt", "de", "it"]) assert.ok(langs.has(l), `${cat} is missing ${l}`);
  }
});

test("hard corpus: covers unsupported, low-resource and transliterated languages", () => {
  const langs = new Set(items.map((i) => i.lang));
  for (const l of ["ur", "ur-roman", "hi", "ar", "zh", "ru", "tr", "nl", "sw", "id", "ca", "gl", "la", "eo", "cy", "eu", "af", "is", "mt", "yo", "hi-latn", "ar-latn", "el-latn", "zh-latn"]) {
    assert.ok(langs.has(l), l);
  }
});

test("hard corpus: bypass items exist, and the obey-token attacks really contain the token", () => {
  assert.ok(items.filter((i) => i.bypass).length >= 50);
  for (const i of items.filter((x) => x.cat === "byp_obey_token" || x.cat === "byp_dan_token")) assert.ok(i.turns[0]!.includes(TOKEN), i.id);
});

test("hard corpus: multi-turn items have at least two turns", () => {
  const mt = items.filter((i) => i.cat === "multi_turn2");
  assert.ok(mt.length >= 4);
  for (const i of mt) assert.ok(i.turns.length >= 2, i.id);
});
