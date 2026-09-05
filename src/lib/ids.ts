import { customAlphabet } from "nanoid";

// URL-safe, unambiguous alphabet (no lookalikes).
const nano = customAlphabet("0123456789abcdefghjkmnpqrstvwxyz", 24);

export type IdPrefix =
  | "usr"
  | "mrc"
  | "key"
  | "prod"
  | "cus"
  | "pi"
  | "route"
  | "ba"
  | "pol"
  | "run"
  | "dec"
  | "apr"
  | "x402"
  | "xtx"
  | "setl"
  | "lacc"
  | "ltx"
  | "lent"
  | "rfnd"
  | "ful"
  | "whe"
  | "whd"
  | "evt"
  | "aud"
  | "idem"
  | "cbl"
  | "otp";

/** Stripe-style prefixed id, e.g. `pi_3x8k2m...`. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${nano()}`;
}

/** Deterministic id for seed data so re-seeding is idempotent. */
export function seedId(prefix: IdPrefix, slug: string): string {
  return `${prefix}_seed_${slug}`;
}
