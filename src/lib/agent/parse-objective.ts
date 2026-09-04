import { moneyFromDecimal } from "@/lib/money/money";
import { ParsedConstraintsSchema, type ParsedConstraints } from "@/lib/policies/policy";
import { structured } from "./model";

const CURRENCY_SYMBOL: Record<string, string> = { "£": "GBP", $: "USD", "€": "EUR", "S$": "SGD" };

/** Deterministic, regex-based objective parser — the demo-mode fallback. */
export function parseObjectiveHeuristically(
  objective: string,
  defaults: { settlementCurrency: string },
): ParsedConstraints {
  const text = objective.replace(/\s+/g, " ").trim();
  const out: ParsedConstraints = {};

  const KNOWN = ["GBP", "SGD", "USD", "EUR", "AUD", "HKD", "JPY"];
  const cur =
    text.match(/(?:receive|send|pay(?:ing)?|settle)\s+(?:in\s+)?([A-Z]{3})\b/) ??
    text.match(new RegExp(`\\b(${KNOWN.join("|")})\\b`));
  out.requiredSettlementCurrency = (
    cur?.[1] ?? defaults.settlementCurrency
  ).toUpperCase();

  const feePct = text.match(/(?:processing\s+(?:cost|fee)[^%\d]*)([\d.]+)\s*%/i);
  if (feePct) out.maxProcessingFeeBps = Math.round(parseFloat(feePct[1]!) * 100);

  const spreadPct = text.match(/(?:fx|spread)[^%\d]*([\d.]+)\s*%/i);
  if (spreadPct) out.maxFxSpreadBps = Math.round(parseFloat(spreadPct[1]!) * 100);

  const secs = text.match(/(?:in|within|under)\s+(\d+)\s*(second|sec|s|minute|min|m|hour|h)/i);
  if (secs) {
    const n = parseInt(secs[1]!, 10);
    const unit = secs[2]!.toLowerCase();
    out.requiredSettlementSeconds = unit.startsWith("h")
      ? n * 3600
      : unit.startsWith("m")
        ? n * 60
        : n;
  }

  const approval = text.match(
    /(?:exceeds?|over|above|more than)\s*(S\$|[£$€])?\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (approval) {
    const sym = approval[1] ?? "£";
    const ccy = CURRENCY_SYMBOL[sym] ?? "GBP";
    out.approvalIfOverAmountMinor = Number(
      moneyFromDecimal(approval[2]!.replace(/,/g, ""), ccy).amount,
    );
    out.approvalIfOverCurrency = ccy;
  }

  const deadline = text.match(/\b(today|tomorrow|by\s+\w+day|end of (?:day|week)|asap)\b/i);
  if (deadline) out.deadline = deadline[0].toLowerCase();

  return ParsedConstraintsSchema.parse(out);
}

const SYSTEM = `You convert a natural-language payment instruction into structured constraints for an autonomous payments agent.
Rules:
- Only extract what is explicitly stated. Do not invent limits.
- Currencies are ISO-4217 (GBP, SGD, USD...). "S$" = SGD, "£" = GBP.
- Percentages become basis points (1% = 100 bps, 0.5% = 50 bps).
- Durations become seconds ("under 60 seconds" = 60, "2 minutes" = 120).
- An approval threshold like "ask for approval if it exceeds £4,000" sets approvalIfOverAmountMinor (minor units, so £4,000 = 400000) and approvalIfOverCurrency.
- These constraints only ever TIGHTEN the user's standing policy; they never loosen it.`;

/** Parse the objective — real LLM structured output in live mode, heuristic in demo. */
export async function parsePaymentObjective(
  objective: string,
  defaults: { settlementCurrency: string },
): Promise<{ constraints: ParsedConstraints; source: "model" | "fallback"; usage?: Record<string, number> }> {
  const res = await structured<ParsedConstraints>({
    label: "parsePaymentObjective",
    schema: ParsedConstraintsSchema,
    system: SYSTEM,
    prompt: `Standing policy settlement currency: ${defaults.settlementCurrency}\n\nInstruction:\n"""${objective}"""`,
    fallback: () => parseObjectiveHeuristically(objective, defaults),
  });
  return { constraints: res.value, source: res.source, usage: res.usage };
}
