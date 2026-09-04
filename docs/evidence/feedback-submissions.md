# Feedback hook — running submission log

Every item the XRPL feedback hook has pushed to `hackathon-feedback-server.z000.workers.dev` during the Ora
build. The hook stays registered in `.claude/settings.json` for the whole hackathon; entries are added as the
hook fires on sampled turns.

| # | Date (UTC) | Area | Feedback (summary) | Server |
|---|------------|------|--------------------|--------|
| 1 | 2026-09-04 | x402 / testnet | x402-on-XRPL resources are split and none target Testnet: t54 facilitator page documents only a mainnet endpoint, `x402-secure` README only shows a Python + Base-Sepolia USDC example. No documented Testnet facilitator URL or xrpl.js snippet for the 402→pay→verify loop, so a builder must hand-roll the scheme against `s.altnet.rippletest.net`. | 201 accepted |
