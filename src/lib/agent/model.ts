import { generateObject, generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { z } from "zod";
import { env, agentModeResolved } from "@/env";
import { logger } from "@/lib/logger";

export type AgentMode = "live" | "demo";

export function agentMode(): AgentMode {
  return agentModeResolved;
}

function anthropicModel(): LanguageModel {
  const provider = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return provider(env.AGENT_MODEL);
}

export interface StructuredCall<T> {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** deterministic result used when running in demo mode or on model failure */
  fallback: () => T;
  label: string;
}

/**
 * Structured LLM call with a deterministic fallback. In `live` mode this is a
 * real Anthropic `generateObject`; in `demo` mode (or if the model errors) it
 * returns `fallback()` so the whole product still runs offline and repeatably.
 */
export async function structured<T>(
  call: StructuredCall<T>,
): Promise<{ value: T; source: "model" | "fallback"; usage?: Record<string, number> }> {
  if (agentMode() === "demo") {
    return { value: call.fallback(), source: "fallback" };
  }
  try {
    const res = await generateObject({
      model: anthropicModel(),
      schema: call.schema,
      system: call.system,
      prompt: call.prompt,
    });
    return {
      value: res.object,
      source: "model",
      usage: res.usage
        ? { inputTokens: res.usage.inputTokens ?? 0, outputTokens: res.usage.outputTokens ?? 0 }
        : undefined,
    };
  } catch (err) {
    logger.warn({ err, label: call.label }, "agent: model call failed, using fallback");
    return { value: call.fallback(), source: "fallback" };
  }
}

export interface TextCall {
  system: string;
  prompt: string;
  fallback: () => string;
  label: string;
}

export async function text(
  call: TextCall,
): Promise<{ value: string; source: "model" | "fallback" }> {
  if (agentMode() === "demo") return { value: call.fallback(), source: "fallback" };
  try {
    const res = await generateText({
      model: anthropicModel(),
      system: call.system,
      prompt: call.prompt,
    });
    return { value: res.text.trim(), source: "model" };
  } catch (err) {
    logger.warn({ err, label: call.label }, "agent: text call failed, using fallback");
    return { value: call.fallback(), source: "fallback" };
  }
}
