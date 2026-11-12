import { GoogleGenAI, FinishReason, ThinkingLevel } from "@google/genai";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { CLASSIFIER_SYSTEM, EmptyReplyError, wrapForClassifier } from "./llm.ts";
import type { LlmClient } from "./llm.ts";
import type { ThinkingLevelName } from "./config.ts";

/** The one SDK method we use. Tests pass a fake with this shape. */
export interface GeminiLike {
  models: { generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> };
}

export interface GeminiOptions {
  model: string;
  classifierModel: string;
  maxOutputTokens: number;
  thinkingLevel?: ThinkingLevelName | undefined;
  /** Defaults to a real client using GEMINI_API_KEY. */
  client?: GeminiLike;
}

const LEVELS: Record<ThinkingLevelName, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

export function createGeminiLlm(opts: GeminiOptions): LlmClient {
  const ai: GeminiLike =
    opts.client ??
    new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      // The SDK default is 5 attempts with delays up to 60 s: far too slow for a chat.
      httpOptions: { timeout: 30_000, retryOptions: { attempts: 2 } },
    });

  const thinking = opts.thinkingLevel ? { thinkingConfig: { thinkingLevel: LEVELS[opts.thinkingLevel] } } : {};

  return {
    async classify(text) {
      const res = await ai.models.generateContent({
        model: opts.classifierModel,
        contents: [{ role: "user", parts: [{ text: wrapForClassifier(text) }] }],
        // Thinking tokens count against maxOutputTokens, so leave room for them.
        config: { systemInstruction: CLASSIFIER_SYSTEM, maxOutputTokens: 1024, ...thinking },
      });
      // A prompt that Gemini itself blocked is treated as an attack.
      if (res.promptFeedback?.blockReason) return "UNSAFE";
      // Fail closed: anything other than exactly "SAFE" counts as UNSAFE.
      return (res.text ?? "").trim().toUpperCase() === "SAFE" ? "SAFE" : "UNSAFE";
    },

    async reply(system, history) {
      const res = await ai.models.generateContent({
        model: opts.model,
        // Gemini calls the assistant role "model".
        contents: history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
        config: { systemInstruction: system, maxOutputTokens: opts.maxOutputTokens, ...thinking },
      });
      if (res.promptFeedback?.blockReason) return { kind: "refusal" };
      const finish = res.candidates?.[0]?.finishReason;
      // Anything other than a normal stop or a length cut (SAFETY, PROHIBITED_CONTENT, ...) is a refusal.
      if (finish !== undefined && finish !== FinishReason.STOP && finish !== FinishReason.MAX_TOKENS) {
        return { kind: "refusal" };
      }
      const text = (res.text ?? "").trim();
      if (!text) {
        const thoughts = res.usageMetadata?.thoughtsTokenCount;
        throw new EmptyReplyError(
          `no text in reply (finishReason=${finish ?? "none"}, thoughtsTokens=${thoughts ?? "n/a"}); ` +
            "if finishReason is MAX_TOKENS, raise MAX_OUTPUT_TOKENS or set THINKING_LEVEL=low",
        );
      }
      return { kind: "text", text };
    },
  };
}
