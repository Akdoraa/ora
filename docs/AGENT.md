# Ora — the AI agent

An auditable, tool-using system — not a chatbot with a payment button.

## What the LLM does (and doesn't)

**Does:** turns a natural-language objective into typed, validated
`ParsedConstraints` (`generateObject` with a Zod schema), and writes the 2–3
sentence plain-English receipt summary (`generateText`).

**Doesn't:** decide routes (deterministic `selectRoute`), approve payments
(deterministic `requiresApproval`), hold a key, sign a transaction, or override a
spend cap. If the model output disagrees with the policy layer, the policy layer
wins.

Provider abstraction: `src/lib/agent/model.ts`. `AGENT_MODE=live` uses Anthropic
via the Vercel AI SDK; `demo` (or any model error) falls back to a deterministic
implementation — a regex objective parser + a template receipt — so the whole
product runs offline and repeatably. The graded live demo uses `live`.

## Tools (each recorded as an `agent_decisions` row: input, output, reason, ok, ms)

| Tool | Kind | Effect |
|---|---|---|
| `parsePaymentObjective` | LLM | objective → typed constraints |
| `discoverMerchantOffer` | deterministic | reads the machine-readable offer / manifest |
| `listQualifiedRoutes` | deterministic | builds + persists 4 candidate routes with quotes |
| `inspectRouteTerms` | deterministic | reads cost / FX / speed / reliability / limits per route |
| `evaluateRoutes` | deterministic | `effectiveConstraints` (policy ∧ objective) → qualify → select + explain |
| `requestHumanApproval` | deterministic gate | creates an `ApprovalRequest` when policy requires it |
| `confirmBankAuthorization` | provider | demo bank authorize + confirm callback |
| `requestPaidQuote` / `handleX402Payment` | real HTTP + XRPL | 402 challenge → presigned Testnet payment → signed FX quote |
| `executeXRPLSettlement` | executor | ledger legs + XRPL payout |
| `verifyXRPLTransaction` | executor | independent `tx` re-read; must be validated + `tesSUCCESS` |
| `triggerMerchantFulfilment` | deterministic | confirms delivery |
| `generateReceipt` | LLM | payer-facing summary |
| `recordAuditEvent` | deterministic | append-only trace (used throughout) |

## Controls (`AgentPolicy`)

Max payment amount, max daily spend, max FX spread (bps), max processing fee
(bps), required settlement time, approved currencies / merchants / providers,
auto-approve threshold, require-approval-for-new-payee. The **objective can only
tighten** these (`effectiveConstraints` takes the min). Hard caps (max payment,
daily spend) are re-checked by `hardSpendGuard` and by the XRPL executor,
independent of any model output.

## Transparency

The UI (`AgentDecisionPanel`) shows: the objective, the parsed constraint chips,
every route with its numbers and qualified/rejected/selected status + reasons,
the ordered decision trace with concise reasons, and — behind "Settlement
details" — the signed quote, both real tx hashes, and explorer links. Chain of
thought is never shown; only decisions and their inspectable factual inputs.

## Failure handling

Every step is wrapped by the `Recorder`; a failure writes an `ok:false`
`agent_decision`, sets `agent_runs.status = failed` with a reason, writes an
`agent.failed` audit event, and returns `{ status: "failed", failedStep }`. The
payment intent lands in the matching recoverable state (see `SEQUENCE.md`).
