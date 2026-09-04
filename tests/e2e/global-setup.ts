import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/**
 * Ensures the embedded DB is migrated + seeded before the E2E server starts.
 * The live demo performs genuine XRPL Testnet operations, so the four wallet
 * seeds must already exist (`pnpm xrpl:setup`).
 */
export default async function globalSetup() {
  const envLocal = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
  const hasWallets = /XRPL_SETTLEMENT_SEED=\S/.test(envLocal) || process.env.XRPL_SETTLEMENT_SEED;
  if (!hasWallets) {
    throw new Error(
      "E2E needs funded XRPL Testnet wallets. Run `pnpm xrpl:setup` first (writes .env.local).",
    );
  }
  execSync("pnpm db:migrate && pnpm db:seed", { stdio: "inherit" });
}
