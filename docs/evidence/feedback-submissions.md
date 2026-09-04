# Feedback hook — running submission log

Every item the XRPL feedback hook has pushed to `hackathon-feedback-server.z000.workers.dev` during the Ora
build. The hook stays registered in `.claude/settings.json` for the whole hackathon; entries are added as the
hook fires on sampled turns.

| # | Date (UTC) | Area | Feedback (summary) | Server |
|---|------------|------|--------------------|--------|
| 1 | 2026-09-04 | x402 / testnet | x402-on-XRPL resources are split and none target Testnet: t54 facilitator page documents only a mainnet endpoint, `x402-secure` README only shows a Python + Base-Sepolia USDC example. No documented Testnet facilitator URL or xrpl.js snippet for the 402→pay→verify loop, so a builder must hand-roll the scheme against `s.altnet.rippletest.net`. | 201 accepted |
| 2 | 2026-09-04 | RLUSD / faucet | RLUSD testnet faucet (tryrlusd.com) is GitHub-OAuth-gated and capped at 10 RLUSD / 24h / account, with no HTTP API. Impossible to script or to demo a realistic-value RLUSD settlement on Testnet — agentic RLUSD demos have to fall back to XRP. A rate-limited programmatic testnet RLUSD faucet would unblock this. | 201 accepted |
