import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Found 2026-11-18: four regexes in scripts/redteam-hard.ts held a BACKSPACE byte (0x08) where "\b" was meant, so the red-team flags
// ANSWERED_OFFTOPIC, ANSWERED_MATH, NUMBER_IN_REPLY and STARTS_YES could never fire. A test with the same slip ("\b" turned into a
// backspace) could never fail either. Such bytes are invisible in an editor, so they are looked for here.
test("no source, test or script file contains a stray control character (tab, CR and LF are fine)", () => {
  const bad: string[] = [];
  for (const dir of ["src", "test", "scripts"]) {
    for (const f of readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(`${dir}/${f}`, "utf8");
      const m = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.exec(text);
      if (m) bad.push(`${dir}/${f} (byte 0x${m[0].charCodeAt(0).toString(16)} at line ${text.slice(0, m.index).split("\n").length})`);
    }
  }
  assert.deepEqual(bad, []);
});
