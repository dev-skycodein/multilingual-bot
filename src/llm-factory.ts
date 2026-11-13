import type { Config } from "./config.ts";
import type { LlmClient } from "./llm.ts";
import { createAnthropicLlm } from "./llm.ts";
import { createGeminiLlm } from "./llm-gemini.ts";
import { createSkycodeinLlm } from "./llm-skycodein.ts";

export function createLlm(config: Config): LlmClient {
  if (config.provider === "skycodein") {
    return createSkycodeinLlm({
      model: config.model,
      classifierModel: config.classifierModel,
      maxOutputTokens: config.maxOutputTokens,
      baseUrl: config.skycodeinBaseUrl,
    });
  }
  if (config.provider === "gemini") {
    return createGeminiLlm({
      model: config.model,
      classifierModel: config.classifierModel,
      maxOutputTokens: config.maxOutputTokens,
      thinkingLevel: config.thinkingLevel,
    });
  }
  return createAnthropicLlm({
    model: config.model,
    classifierModel: config.classifierModel,
    maxOutputTokens: config.maxOutputTokens,
  });
}

/** Name of the environment variable that must hold the key for this provider. */
export function keyVariable(config: Config): string {
  if (config.provider === "skycodein") return "SKYCODEIN_API_KEY";
  return config.provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
}
