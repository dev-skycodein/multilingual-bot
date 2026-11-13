import { GoogleGenAI, FinishReason, ThinkingLevel, Type } from "@google/genai";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { CLASSIFIER_SYSTEM, EmptyReplyError, parseVerdict, wrapForClassifier } from "./llm.ts";
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
    async classify(text, context) {
      const res = await ai.models.generateContent({
        model: opts.classifierModel,
        contents: [{ role: "user", parts: [{ text: wrapForClassifier(text, context) }] }],
        config: {
          systemInstruction: CLASSIFIER_SYSTEM,
          // Thinking tokens count against maxOutputTokens, so leave room for them.
          maxOutputTokens: 1024,
          // Structured output: the answer is {"verdict":"SAFE"|"UNSAFE"}, so a stray full stop or
          // markdown cannot turn a harmless message into a block.
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: { verdict: { type: Type.STRING, enum: ["SAFE", "UNSAFE"] } },
            required: ["verdict"],
          },
          ...thinking,
        },
      });
      // A prompt that Gemini itself blocked is treated as an attack.
      if (res.promptFeedback?.blockReason) return "UNSAFE";
      return parseVerdict(res.text);
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
      // A reply cut by the token limit is trimmed to its last full sentence (or marked with an ellipsis).
      return { kind: "text", text: finish === FinishReason.MAX_TOKENS ? trimTruncated(text) : text };
    },
  };
}

/** Cuts a token-limited reply at the last sentence end, but only if that keeps a useful part of it. */
export function trimTruncated(text: string): string {
  let cut = -1;
  for (const m of text.matchAll(/[.!?。！？](?=\s|$)/gu)) cut = m.index!;
  if (cut >= text.length * 0.3) return text.slice(0, cut + 1).trim();
  return text.trimEnd() + "…";
}
