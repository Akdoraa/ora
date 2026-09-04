/**
 * End-to-end x402 smoke test. Requires the dev server running (pnpm dev).
 * Hits the real /api/x402/quote endpoint: 402 challenge -> presigned XRPL
 * Testnet payment -> signed FX quote.
 *
 *   pnpm x402:smoke
 */
import { payForResource } from "@/lib/x402/client";
import { getWalletAddress } from "@/lib/xrpl/wallets";
import { env } from "@/env";
import { xrpToDrops } from "xrpl";

async function main() {
  const url = `${env.APP_URL}/api/x402/quote`;
  const paymentIntentId = `pi_smoke_${Date.now()}`;

  const result = await payForResource({
    url,
    method: "POST",
    body: {
      paymentIntentId,
      amountInMinor: "425000",
      amountInCurrency: "GBP",
      amountOutCurrency: "SGD",
      midRate: "1.7180",
      fxSpreadBps: 35,
      processingFeeBps: 100,
    },
    fromRole: "agent",
    guard: {
      maxAmount: xrpToDrops("2"),
      allowedAsset: "XRP",
      expectedPayTo: getWalletAddress("oracle"),
    },
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.paid && result.quoteEnvelope ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
