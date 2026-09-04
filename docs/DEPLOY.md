# Ora — deployment

Target: **Vercel** (Next.js) + **Neon** (serverless Postgres). Needs the
operator's own accounts — this is a hand-off step.

## 1. Database (Neon)

```bash
# create a Neon project, copy the pooled connection string
export DATABASE_URL="postgres://…-pooler.neon.tech/ora?sslmode=require"
pnpm db:migrate      # drizzle-kit detects the postgres:// URL and uses node-postgres
pnpm db:seed
```

Drizzle migrations in `drizzle/` are dialect-`postgresql` and run unchanged on
Neon (they were generated against the same schema PGlite uses locally).

## 2. XRPL wallets

`pnpm xrpl:setup` locally, then copy the four `XRPL_*_SEED` values into Vercel
project env vars (they are **not** in the repo). For a Mainnet deployment,
create the wallets out-of-band in a hardened environment and set
`XRPL_NETWORK=mainnet` + `XRPL_WSS_URL`.

## 3. Vercel

- Framework preset: Next.js. Build: `pnpm build`. Install: `pnpm install`.
- `vercel.json` sets `maxDuration` for the agent + x402 routes (real Testnet
  calls take 10–20s).
- Env vars: everything in `.env.example` — at minimum `DATABASE_URL`,
  `APP_URL` / `NEXT_PUBLIC_APP_URL` (the deployed URL), `SESSION_SECRET`,
  `WEBHOOK_SIGNING_SECRET`, `X402_QUOTE_SIGNING_SECRET`, the four
  `XRPL_*_SEED`, and `ANTHROPIC_API_KEY` for the live agent.
- After first deploy: run `pnpm db:seed` against the Neon URL (or a one-off
  Vercel job) so `/demo` and `/dashboard` have data.

## 4. Verify

Open `<deployed-url>/demo`, run the flow, and confirm both hashes resolve on
`testnet.xrpl.org`. `pnpm demo:run` with `APP_URL=<deployed-url>` does this
headless.

## Notes

- The in-process x402 facilitator and the XRPL ws client both run in the Node
  serverless runtime (`export const runtime = "nodejs"` on the relevant routes).
- PGlite is dev-only; it is never used when `DATABASE_URL` is a `postgres://`
  URL.
