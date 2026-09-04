# Feedback hook — installation & running evidence

- **Team:** Ora · **Builder:** Akdora Celepoglu
- **Config:** `~/.xrpl-feedback-hook.json` holds only `teamName` / `hackerName`. The feedback server URL and
  auth token are baked into `hook/submit.mjs` (shared hackathon secret) — no API key or LLM key involved.
- **Registration (project-scoped, not global):** `Stop` hook in `.claude/settings.json` →
  `node "$CLAUDE_PROJECT_DIR/hook/agents/claude-code/stop-hook.mjs"`. It fires after each turn, samples
  (~20% by default), and on a sampled turn injects the reflection instruction (exit 2) so this agent's own
  model judges whether the turn revealed real XRPL friction and, if so, runs `hook/submit.mjs`.
- **Node:** v24.14.0 · **Installed:** 2026-09-04

## Test 1 — `submit.mjs` rejects too-short text (client-side validation)

```
$ node hook/submit.mjs --text "short"
xrpl-feedback submit: feedback must be at least 50 characters
```

## Test 2 — Stop-hook injects on a sampled turn

```
$ printf '%s' '{"hook_event_name":"Stop","stop_hook_active":false}' | XRPL_FEEDBACK_SAMPLE=1 node hook/agents/claude-code/stop-hook.mjs
injection exit code: 2      # 2 == reflection instruction injected back into the model
```

## Test 3 — Stop-hook loop guard (never recurses)

```
$ printf '%s' '{"hook_event_name":"Stop","stop_hook_active":true}' | XRPL_FEEDBACK_SAMPLE=1 node hook/agents/claude-code/stop-hook.mjs
loop-guard exit code: 0     # 0 == allows the turn to end, no recursion
```

## Test 4 — real end-to-end submission accepted by the server (HTTP 201)

```
$ node hook/submit.mjs --text "Building an x402 flow on XRPL Testnet ... has to hand-roll the whole scheme ... against s.altnet.rippletest.net themselves."
feedback submitted
submit exit: 0
```

See `docs/evidence/feedback-submissions.md` for the running log of every item this hook has pushed during the build.
