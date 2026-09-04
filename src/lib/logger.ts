import pino from "pino";
import { env } from "@/env";

/**
 * Structured server logger. Redacts obvious secrets; callers must still never
 * pass seeds, tokens, PAN, or raw bank credentials into log context.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "seed",
      "*.seed",
      "privateKey",
      "*.privateKey",
      "secret",
      "*.secret",
      "authorization",
      "*.authorization",
      "password",
      "*.password",
      "apiKey",
      "*.apiKey",
      "token",
      "*.token",
    ],
    censor: "[redacted]",
  },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
