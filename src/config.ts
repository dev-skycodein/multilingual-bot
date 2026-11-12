export type Provider = "gemini" | "anthropic";
export type ThinkingLevelName = "minimal" | "low" | "medium" | "high";

export interface Config {
  host: string;
  port: number;
  productName: string;
  provider: Provider;
  model: string;
  classifierModel: string;
  /** Gemini only. Unset = the model's own default. */
  thinkingLevel: ThinkingLevelName | undefined;
  maxInputChars: number;
  maxHistoryMessages: number;
  maxOutputTokens: number;
  ratePerMinute: number;
  dailyRequestCap: number;
  sessionTtlMs: number;
  maxSessions: number;
}

// Model IDs come from Google's and Anthropic's published model lists. They have
// not been called live from this project yet: run `npm run smoke` to check them.
const DEFAULT_MODELS: Record<Provider, { model: string; classifierModel: string }> = {
  // gemini-3.6-flash and gemini-3.8-flash answered 503/504 (overload) in the first live
  // tests, while gemini-3.5-flash-lite worked, so the lite model is the default for both roles.
  gemini: { model: "gemini-3.5-flash-lite", classifierModel: "gemini-3.5-flash-lite" },
  anthropic: { model: "claude-sonnet-5-5", classifierModel: "claude-haiku-5-5" },
};

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid ${name}: must be an integer between ${min} and ${max}`);
  }
  return n;
}

function oneOf<T extends string>(env: NodeJS.ProcessEnv, name: string, allowed: readonly T[]): T | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = raw.toLowerCase();
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${name}: must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const provider = oneOf(env, "LLM_PROVIDER", ["gemini", "anthropic"] as const) ?? "gemini";
  const defaults = DEFAULT_MODELS[provider];
  return {
    host: env.HOST || "127.0.0.1",
    port: int(env, "PORT", 3000, 1, 65535),
    productName: env.PRODUCT_NAME || "OpBritops",
    provider,
    model: env.MODEL || defaults.model,
    classifierModel: env.CLASSIFIER_MODEL || defaults.classifierModel,
    thinkingLevel: oneOf(env, "THINKING_LEVEL", ["minimal", "low", "medium", "high"] as const),
    maxInputChars: int(env, "MAX_INPUT_CHARS", 1000, 1, 10000),
    maxHistoryMessages: int(env, "MAX_HISTORY_MESSAGES", 12, 2, 100),
    maxOutputTokens: int(env, "MAX_OUTPUT_TOKENS", 600, 50, 4000),
    ratePerMinute: int(env, "RATE_PER_MINUTE", 15, 1, 1000),
    dailyRequestCap: int(env, "DAILY_REQUEST_CAP", 2000, 1, 1_000_000),
    sessionTtlMs: 30 * 60 * 1000,
    maxSessions: 5000,
  };
}
