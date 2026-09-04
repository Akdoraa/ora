/**
 * Central, Zod-validated environment access.
 *
 * Import `env` from here — never read `process.env` directly elsewhere.
 * Server-only secrets (XRPL seeds, session secret, model key) are guarded: this
 * module throws if it is ever bundled for the browser.
 */
import { z } from "zod";

const isServer = typeof window === "undefined";

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_XRPL_NETWORK: z.enum(["testnet", "devnet", "mainnet"]).default("testnet"),
});

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Unset => embedded PGlite (zero-infra local dev). Set to a `postgres://` /
  // `postgresql://` URL (e.g. Neon in prod, or the docker-compose Postgres) to
  // use node-postgres instead.
  DATABASE_URL: z.string().min(1).optional(),
  PGLITE_DATA_DIR: z.string().default("./.pglite"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z
    .string()
    .min(16)
    .default("dev-only-insecure-session-secret-change-me"),

  // --- AI agent -------------------------------------------------------------
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AGENT_MODE: z.enum(["live", "demo", "auto"]).default("auto"),
  AGENT_MODEL: z.string().default("claude-sonnet-5"),

  // --- XRPL ---------------------------------------------------------------
  XRPL_NETWORK: z.enum(["testnet", "devnet", "mainnet"]).default("testnet"),
  XRPL_WSS_URL: z.string().default("wss://s.altnet.rippletest.net:51233"),
  XRPL_RPC_URL: z.string().url().default("https://s.altnet.rippletest.net:51234"),
  XRPL_EXPLORER_URL: z.string().url().default("https://testnet.xrpl.org"),
  XRPL_SOURCE_TAG: z.coerce.number().int().default(20260530),

  // Server-held wallets (seeds). Optional so the app boots pre-`xrpl:setup`;
  // XRPL-dependent flows surface a "wallet not configured" state without one.
  XRPL_SETTLEMENT_SEED: z.string().optional(),
  XRPL_ORACLE_SEED: z.string().optional(),
  XRPL_AGENT_SEED: z.string().optional(),
  XRPL_MERCHANT_SEED: z.string().optional(),

  // RLUSD on XRPL Testnet (verify against tryrlusd.com / RLUSD docs before mainnet).
  RLUSD_ISSUER: z.string().default("rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV"),
  RLUSD_CURRENCY_HEX: z
    .string()
    .default("524C555344000000000000000000000000000000"),

  // --- x402 -------------------------------------------------------------------
  // Empty => Ora runs its own in-process facilitator against XRPL Testnet.
  X402_FACILITATOR_URL: z.string().optional(),
  X402_ORACLE_PRICE_RLUSD: z.string().default("0.50"),

  // --- platform ------------------------------------------------------------
  WEBHOOK_SIGNING_SECRET: z
    .string()
    .min(16)
    .default("dev-only-insecure-webhook-secret-change-me"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

/** Treat empty-string env values (common in .env files) as unset. */
function compact(source: Record<string, string | undefined>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return out;
}

function parseEnv() {
  if (!isServer) {
    const parsed = clientSchema.safeParse({
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      NEXT_PUBLIC_XRPL_NETWORK: process.env.NEXT_PUBLIC_XRPL_NETWORK,
    });
    if (!parsed.success) {
      console.error("Invalid public env:", parsed.error.flatten().fieldErrors);
      throw new Error("Invalid public environment variables");
    }
    return parsed.data as z.infer<typeof serverSchema> & z.infer<typeof clientSchema>;
  }

  const merged = serverSchema.merge(clientSchema);
  const src = compact(process.env);
  const parsed = merged.safeParse({
    ...src,
    NEXT_PUBLIC_APP_URL: src.NEXT_PUBLIC_APP_URL ?? src.APP_URL,
    NEXT_PUBLIC_XRPL_NETWORK: src.NEXT_PUBLIC_XRPL_NETWORK ?? src.XRPL_NETWORK,
  });
  if (!parsed.success) {
    console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables — see .env.example");
  }
  return parsed.data;
}

export const env = parseEnv();

export const dbDriver: "pg" | "pglite" =
  isServer && env.DATABASE_URL && /^postgres(ql)?:\/\//.test(env.DATABASE_URL)
    ? "pg"
    : "pglite";

export const agentModeResolved: "live" | "demo" =
  env.AGENT_MODE === "auto"
    ? env.ANTHROPIC_API_KEY
      ? "live"
      : "demo"
    : env.AGENT_MODE;

export type Env = typeof env;
