import { seedId } from "@/lib/ids";

/**
 * The dashboard is demo-scoped to the seeded merchant. A production build swaps
 * this for a session lookup (Auth.js) — see docs/SECURITY.md.
 */
export function currentMerchantId(): string {
  return seedId("mrc", "marina");
}

export const DEMO_API_KEY = "ora_sk_test_marina_9c2f4e7a1b8d";
