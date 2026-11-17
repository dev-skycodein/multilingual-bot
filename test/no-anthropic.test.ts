import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Decision 2026-11-18: this project uses Gemini, and SkyCodein when the Gemini quota is used up. Anthropic is not a provider.
// ("Anthropic" still appears in the attack wording of the prompts: a message claiming to come from Anthropic is untrusted.)
test("the Anthropic SDK is neither a dependency nor imported, and there is no Anthropic client or key variable", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.dependencies?.["@anthropic-ai/sdk"], undefined);
  assert.equal(pkg.devDependencies?.["@anthropic-ai/sdk"], undefined);
  for (const f of readdirSync("src", { recursive: true }).map(String).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(`src/${f}`, "utf8");
    assert.doesNotMatch(text, /@anthropic-ai/, f);
    assert.doesNotMatch(text, /createAnthropicLlm|ANTHROPIC_API_KEY/, f);
  }
  assert.doesNotMatch(readFileSync(".env.example", "utf8"), /ANTHROPIC/i);
});
