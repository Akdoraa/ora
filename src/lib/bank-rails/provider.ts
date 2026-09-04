import type { BankAuthorization } from "@/db/schema";

export interface BankOption {
  id: string;
  name: string;
  logoInitials: string;
  country: string;
}

export type BankAuthSimulation = "confirm" | "fail" | "expire";

export interface CreateAuthorizationInput {
  paymentIntentId: string;
  amountMinor: bigint;
  currency: string;
  method: "bank" | "qr";
  bankId?: string;
}

/**
 * The seam between Ora and a licensed bank-rail / open-banking partner.
 * Ora owns everything above this line (checkout, routing, ledger, agent
 * policy). A production adapter for a licensed FAST / PayNow / open-banking
 * partner implements the same interface. Ora never stores raw bank credentials.
 */
export interface BankRailProvider {
  readonly name: string;
  listBanks(country: string): Promise<BankOption[]>;
  createAuthorization(input: CreateAuthorizationInput): Promise<BankAuthorization>;
  getAuthorization(id: string): Promise<BankAuthorization | null>;
  /** advance a pending authorization — the demo provider simulates the bank callback */
  confirmAuthorization(
    id: string,
    simulate?: BankAuthSimulation,
  ): Promise<BankAuthorization>;
  cancelAuthorization(id: string): Promise<BankAuthorization>;
}
