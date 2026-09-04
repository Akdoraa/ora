/**
 * End-to-end smoke test of the XRPL executor against Testnet.
 * Sends a tiny XRP payment agent -> oracle, then verifies it independently.
 *
 *   pnpm xrpl:smoke
 */
import { executePayment } from "@/lib/xrpl/executor";
import { verifyTransactionByHash } from "@/lib/xrpl/verify";
import { getWalletAddress } from "@/lib/xrpl/wallets";
import { disconnectXrpl } from "@/lib/xrpl/client";

async function main() {
  const oracle = getWalletAddress("oracle");
  console.log(`paying 0.25 XRP: agent -> oracle (${oracle})`);

  const result = await executePayment({
    kind: "x402_payment",
    from: "agent",
    to: oracle,
    amount: { asset: "XRP", value: "0.25" },
    invoiceId: `smoke-${Date.now()}`,
    memo: "ora smoke test",
  });

  console.log("\nexecutor result:\n" + JSON.stringify(result, null, 2));

  const v = await verifyTransactionByHash(result.hash);
  console.log("\nindependent verification:\n" + JSON.stringify(v, null, 2));

  await disconnectXrpl();
  process.exit(v.success ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
