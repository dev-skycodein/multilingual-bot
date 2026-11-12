import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAttacks } from "../scripts/attacks.ts";

// Encoded / obfuscated attacks exist in English only on purpose.
const ENGLISH_ONLY = new Set(["encoded", "obfuscated"]);

test("red-team corpus: ids are unique and every translated category covers all six languages", () => {
  const attacks = buildAttacks();
  assert.equal(new Set(attacks.map((a) => a.id)).size, attacks.length);

  const langsByCategory = new Map<string, string[]>();
  for (const a of attacks) {
    if (a.legit || ENGLISH_ONLY.has(a.category)) continue;
    langsByCategory.set(a.category, [...(langsByCategory.get(a.category) ?? []), a.lang]);
  }
  assert.ok(langsByCategory.size >= 8, "at least 8 translated attack categories");
  for (const [category, langs] of langsByCategory) {
    assert.deepEqual([...langs].sort(), ["de", "en", "es", "fr", "it", "pt"], category);
  }
});

test("red-team corpus: includes false-positive checks in all six languages", () => {
  const greetings = buildAttacks().filter((a) => a.category === "legit");
  assert.deepEqual(greetings.map((a) => a.lang).sort(), ["de", "en", "es", "fr", "it", "pt"]);
});
