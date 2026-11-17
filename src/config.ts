export type Provider = "gemini" | "skycodein";
export type ThinkingLevelName = "minimal" | "low" | "medium" | "high";

export interface Config {
  host: string;
  port: number;
  productName: string;
  provider: Provider;
  /** SkyCodein provider only: the API's /v1 address. */
  skycodeinBaseUrl: string;
  model: string;
  classifierModel: string;
  /** Gemini only. Unset = the model's own default. */
  thinkingLevel: ThinkingLevelName | undefined;
  maxInputChars: number;
  maxHistoryMessages: number;
  maxOutputTokens: number;
  ratePerMinute: number;
  dailyRequestCap: number;
  /** Requests one client (IP) may make per UTC day. */
  perClientDailyCap: number;
  /** Number of trusted reverse proxies in front of us; 0 = use the socket address and ignore X-Forwarded-For. */
  trustProxyHops: number;
  /** Host header values accepted (lower case, no port). Empty = no check. */
  allowedHosts: string[];
  sessionTtlMs: number;
  maxSessions: number;
}

// Providers: Gemini, and SkyCodein when the Gemini quota is used up. Run `npm run smoke` to check a model name.
const DEFAULT_MODELS: Record<Provider, { model: string; classifierModel: string }> = {
  // gemini-3.6-flash and gemini-3.8-flash answered 503/504 (overload) in the first live
  // tests, while gemini-3.5-flash-lite worked, so the lite model is the default for both roles.
  gemini: { model: "gemini-3.5-flash-lite", classifierModel: "gemini-3.5-flash-lite" },
  // Not the auto-router "skycodein": it picks the coding assistant from the message text, which an attacker could steer.
  skycodein: { model: "skycodein-general", classifierModel: "skycodein-general" },
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

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function allowedHosts(env: NodeJS.ProcessEnv, host: string): string[] {
  const raw = env.ALLOWED_HOSTS;
  if (raw !== undefined && raw.trim() !== "") {
    return raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  }
  // On a loopback address only local names are valid. This blocks DNS-rebinding pages.
  return LOOPBACK.has(host.toLowerCase()) ? ["localhost", "127.0.0.1", "[::1]"] : [];
}

/**
 * The SkyCodein API address has NO default: it is a private-network address that changes (it already moved once) and it
 * must not be written into committed code. Required only when SkyCodein is the provider.
 */
function skycodeinBaseUrl(env: NodeJS.ProcessEnv, provider: Provider): string {
  const url = (env.SKYCODEIN_BASE_URL ?? "").trim();
  if (url === "") {
    if (provider === "skycodein") {
      throw new Error("SKYCODEIN_BASE_URL is not set. Put the address of the SkyCodein API in .env, for example http://<host>:8000/v1 (it must end in /v1).");
    }
    return "";
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid SKYCODEIN_BASE_URL: it must be a full address such as http://<host>:8000/v1");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Invalid SKYCODEIN_BASE_URL: it must start with http:// or https://");
  return url;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const provider = oneOf(env, "LLM_PROVIDER", ["gemini", "skycodein"] as const) ?? "gemini";
  const defaults = DEFAULT_MODELS[provider];
  const host = env.HOST || "127.0.0.1";
  return {
    host,
    port: int(env, "PORT", 3000, 1, 65535),
    productName: env.PRODUCT_NAME || "OpBritops",
    provider,
    skycodeinBaseUrl: skycodeinBaseUrl(env, provider),
    model: env.MODEL || defaults.model,
    classifierModel: env.CLASSIFIER_MODEL || defaults.classifierModel,
    thinkingLevel: oneOf(env, "THINKING_LEVEL", ["minimal", "low", "medium", "high"] as const),
    maxInputChars: int(env, "MAX_INPUT_CHARS", 1000, 1, 10000),
    maxHistoryMessages: int(env, "MAX_HISTORY_MESSAGES", 12, 2, 100),
    maxOutputTokens: int(env, "MAX_OUTPUT_TOKENS", 600, 50, 4000),
    ratePerMinute: int(env, "RATE_PER_MINUTE", 15, 1, 1000),
    dailyRequestCap: int(env, "DAILY_REQUEST_CAP", 2000, 1, 1_000_000),
    perClientDailyCap: int(env, "PER_CLIENT_DAILY_CAP", 200, 1, 1_000_000),
    trustProxyHops: int(env, "TRUST_PROXY_HOPS", 0, 0, 5),
    allowedHosts: allowedHosts(env, host),
    sessionTtlMs: 30 * 60 * 1000,
    maxSessions: 5000,
  };
}
