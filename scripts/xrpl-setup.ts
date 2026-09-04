/**
 * Create + faucet-fund the four demo XRPL Testnet wallets, set RLUSD trust
 * lines (best effort), and append the seeds to .env.local.
 *
 *   pnpm xrpl:setup            # create any missing wallets
 *   pnpm xrpl:setup --force    # recreate all four
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { Client, Wallet } from "xrpl";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* absent */
  }
}

const WSS = process.env.XRPL_WSS_URL ?? "wss://s.altnet.rippletest.net:51233";
const RLUSD_ISSUER = process.env.RLUSD_ISSUER ?? "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";
const RLUSD_HEX =
  process.env.RLUSD_CURRENCY_HEX ?? "524C555344000000000000000000000000000000";
const SOURCE_TAG = Number(process.env.XRPL_SOURCE_TAG ?? 20260530);
const FORCE = process.argv.includes("--force");

const ROLES = [
  ["settlement", "XRPL_SETTLEMENT_SEED"],
  ["oracle", "XRPL_ORACLE_SEED"],
  ["agent", "XRPL_AGENT_SEED"],
  ["merchant", "XRPL_MERCHANT_SEED"],
] as const;

const ENV_PATH = ".env.local";

function readEnvFile(): string {
  if (!existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, existsSync(".env.example") ? readFileSync(".env.example") : "");
  }
  return readFileSync(ENV_PATH, "utf8");
}

function setEnvVar(key: string, value: string) {
  let content = readEnvFile();
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) {
    content = content.replace(re, line);
    writeFileSync(ENV_PATH, content);
  } else {
    appendFileSync(ENV_PATH, (content.endsWith("\n") ? "" : "\n") + line + "\n");
  }
  process.env[key] = value;
}

async function main() {
  const client = new Client(WSS, { timeout: 30_000 });
  await client.connect();
  console.log(`connected ${WSS}\n`);

  const wallets: Record<string, Wallet> = {};

  for (const [role, envKey] of ROLES) {
    const existing = process.env[envKey];
    let wallet: Wallet;

    if (existing && !FORCE) {
      wallet = Wallet.fromSeed(existing);
      console.log(`· ${role.padEnd(11)} reuse   ${wallet.classicAddress}`);
    } else {
      const funded = await client.fundWallet(null, { faucetHost: undefined });
      wallet = funded.wallet;
      setEnvVar(envKey, wallet.seed!);
      console.log(
        `· ${role.padEnd(11)} funded  ${wallet.classicAddress}  (${funded.balance} XRP)`,
      );
    }
    wallets[role] = wallet;

    // top up so every wallet comfortably covers reserve + fees + demo transfers
    try {
      const info = await client.request({
        command: "account_info",
        account: wallet.classicAddress,
        ledger_index: "validated",
      });
      const xrp = Number(info.result.account_data.Balance) / 1_000_000;
      if (xrp < 40) {
        const t = await client.fundWallet(wallet, {});
        console.log(`    topped up ${role} -> ${t.balance} XRP`);
      }
    } catch {
      /* ignore */
    }
  }

  // RLUSD trust lines (best effort — the testnet RLUSD faucet is GitHub-gated
  // and 10/day, so balances will usually be 0; the code path still works if a
  // wallet is later funded with RLUSD).
  for (const role of ["settlement", "oracle", "agent", "merchant"] as const) {
    const w = wallets[role]!;
    try {
      const lines = await client.request({
        command: "account_lines",
        account: w.classicAddress,
        peer: RLUSD_ISSUER,
      });
      if (lines.result.lines.length > 0) {
        console.log(`· ${role.padEnd(11)} RLUSD trustline present`);
        continue;
      }
      const res = await client.submitAndWait(
        {
          TransactionType: "TrustSet",
          Account: w.classicAddress,
          SourceTag: SOURCE_TAG,
          LimitAmount: { currency: RLUSD_HEX, issuer: RLUSD_ISSUER, value: "1000000" },
        },
        { wallet: w, autofill: true },
      );
      const code = (res.result.meta as { TransactionResult?: string })?.TransactionResult;
      console.log(`· ${role.padEnd(11)} RLUSD TrustSet ${code}`);
    } catch (err) {
      console.log(
        `· ${role.padEnd(11)} RLUSD trustline skipped (${err instanceof Error ? err.message : err})`,
      );
    }
  }

  await client.disconnect();

  console.log("\nWallets ready. Addresses:");
  for (const [role] of ROLES) {
    console.log(`  ${role.padEnd(11)} ${wallets[role]!.classicAddress}`);
  }
  console.log("\nSeeds written to .env.local (gitignored). Do not share them.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
