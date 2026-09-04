import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import type {
  BankRailProvider,
  BankOption,
  CreateAuthorizationInput,
  BankAuthSimulation,
} from "./provider";
import type { BankAuthorization } from "@/db/schema";

const BANKS: Record<string, BankOption[]> = {
  GB: [
    { id: "gb-monzo", name: "Monzo", logoInitials: "MZ", country: "GB" },
    { id: "gb-barclays", name: "Barclays", logoInitials: "BC", country: "GB" },
    { id: "gb-lloyds", name: "Lloyds", logoInitials: "LL", country: "GB" },
    { id: "gb-hsbc", name: "HSBC UK", logoInitials: "HS", country: "GB" },
    { id: "gb-starling", name: "Starling Bank", logoInitials: "ST", country: "GB" },
  ],
  SG: [
    { id: "sg-dbs", name: "DBS", logoInitials: "DB", country: "SG" },
    { id: "sg-ocbc", name: "OCBC", logoInitials: "OC", country: "SG" },
    { id: "sg-uob", name: "UOB", logoInitials: "UO", country: "SG" },
  ],
};

const AUTH_TTL_MS = 5 * 60_000;

/**
 * Demo bank-rail provider. Persists to `bank_authorizations`, simulates the
 * pending -> confirmed callback, and can simulate failed / expired outcomes for
 * the failure-path demos. No credentials, real or fake, are ever stored.
 */
export class DemoBankProvider implements BankRailProvider {
  readonly name = "ora_demo_bank";

  async listBanks(country: string): Promise<BankOption[]> {
    return BANKS[country.toUpperCase()] ?? BANKS.GB!;
  }

  async createAuthorization(input: CreateAuthorizationInput): Promise<BankAuthorization> {
    const db = await getDb();
    const id = newId("ba");
    const bank = input.bankId
      ? Object.values(BANKS)
          .flat()
          .find((b) => b.id === input.bankId)
      : undefined;
    const ref = `ORA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const [row] = await db
      .insert(schema.bankAuthorizations)
      .values({
        id,
        paymentIntentId: input.paymentIntentId,
        provider: this.name,
        bankId: input.bankId,
        bankName: bank?.name,
        method: input.method,
        status: "pending",
        accountMask: `•••• ${Math.floor(1000 + Math.random() * 8999)}`,
        amount: input.amountMinor,
        currency: input.currency,
        authorizationReference: ref,
        qrPayload:
          input.method === "qr"
            ? `ora://pay?ref=${ref}&amt=${input.amountMinor}&ccy=${input.currency}`
            : null,
        expiresAt: new Date(Date.now() + AUTH_TTL_MS),
      })
      .returning();
    return row!;
  }

  async getAuthorization(id: string): Promise<BankAuthorization | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(schema.bankAuthorizations)
      .where(eq(schema.bankAuthorizations.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async confirmAuthorization(
    id: string,
    simulate: BankAuthSimulation = "confirm",
  ): Promise<BankAuthorization> {
    const db = await getDb();
    const current = await this.getAuthorization(id);
    if (!current) throw new Error(`bank authorization ${id} not found`);
    if (current.status !== "pending") return current;

    if (current.expiresAt && current.expiresAt.getTime() < Date.now()) {
      simulate = "expire";
    }

    const patch: Partial<BankAuthorization> =
      simulate === "confirm"
        ? { status: "confirmed", confirmedAt: new Date() }
        : simulate === "fail"
          ? { status: "failed", failureReason: "bank declined the authorization (insufficient funds)" }
          : { status: "expired", failureReason: "authorization window elapsed" };

    const [row] = await db
      .update(schema.bankAuthorizations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.bankAuthorizations.id, id))
      .returning();
    return row!;
  }

  async cancelAuthorization(id: string): Promise<BankAuthorization> {
    const db = await getDb();
    const [row] = await db
      .update(schema.bankAuthorizations)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(schema.bankAuthorizations.id, id))
      .returning();
    return row!;
  }
}

export const demoBankProvider = new DemoBankProvider();
