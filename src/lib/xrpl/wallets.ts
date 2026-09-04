import { Wallet } from "xrpl";
import { env } from "@/env";

/**
 * The named server-held wallets. Seeds come from env only — never the client,
 * never logs, never the LLM. `null` when unconfigured (pre `pnpm xrpl:setup`).
 */
export type WalletRole = "settlement" | "oracle" | "agent" | "merchant";

const SEED_ENV: Record<WalletRole, string | undefined> = {
  settlement: env.XRPL_SETTLEMENT_SEED,
  oracle: env.XRPL_ORACLE_SEED,
  agent: env.XRPL_AGENT_SEED,
  merchant: env.XRPL_MERCHANT_SEED,
};

const cache = new Map<WalletRole, Wallet>();

export function getWallet(role: WalletRole): Wallet {
  const cached = cache.get(role);
  if (cached) return cached;
  const seed = SEED_ENV[role];
  if (!seed) {
    throw new WalletNotConfiguredError(role);
  }
  const wallet = Wallet.fromSeed(seed);
  cache.set(role, wallet);
  return wallet;
}

export function getWalletAddress(role: WalletRole): string {
  return getWallet(role).classicAddress;
}

export function isWalletConfigured(role: WalletRole): boolean {
  return !!SEED_ENV[role];
}

export function allWalletsConfigured(): boolean {
  return (Object.keys(SEED_ENV) as WalletRole[]).every(isWalletConfigured);
}

export class WalletNotConfiguredError extends Error {
  constructor(public readonly role: WalletRole) {
    super(
      `XRPL ${role} wallet is not configured. Run \`pnpm xrpl:setup\` to create and fund the demo wallets.`,
    );
    this.name = "WalletNotConfiguredError";
  }
}
