// The wrapper the live red-team scripts put around the real model client. It remembers the last error, and for "bypass"
// items it can force the classifier to say SAFE so the main model's own defences are tested.
// It MUST forward everything the real client offers: when it did not forward classifyWithLanguage, the scope gate and the
// classifier's language never ran in the hard red-team, and its results said nothing about them.
import type { LlmClient } from "../src/llm.ts";

export interface SpyControl {
  /** Classifier answers SAFE (and no scope, no language) without calling the model. */
  forceSafe: boolean;
  lastErr: string;
}

export function describeError(e: unknown): string {
  const x = e as { name?: string; status?: number; message?: string };
  return `${x?.name} status=${x?.status} ${String(x?.message).slice(0, 300)}`;
}

export function spyLlm(real: LlmClient, ctl: SpyControl): LlmClient {
  const remember = async <T>(p: Promise<T>): Promise<T> => {
    try { return await p; } catch (e) { ctl.lastErr = describeError(e); throw e; }
  };
  const llm: LlmClient = {
    async classify(t, ctx) {
      if (ctl.forceSafe) return "SAFE";
      return remember(real.classify(t, ctx));
    },
    async reply(s, h) {
      return remember(real.reply(s, h));
    },
  };
  if (real.classifyWithLanguage) {
    llm.classifyWithLanguage = async (t, ctx) => {
      if (ctl.forceSafe) return { verdict: "SAFE", language: undefined, scope: undefined };
      return remember(real.classifyWithLanguage!(t, ctx));
    };
  }
  return llm;
}
