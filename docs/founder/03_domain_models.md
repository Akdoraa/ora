# ORA — Domain Models

Entities and invariants for the ledger, quotes, conversions, provider events, and spend. Balances are always derived from ledger entries; no direct balance updates.

---

## 1. Entities

### User

- **Purpose:** Identity that can hold value and perform actions. One user has one or more **LedgerAccount**(s) (e.g. default wallet, or per-currency).
- **Attributes (conceptual):** `user_id` (stable id), auth/identity linkage, created_at. No balance stored here; balance is derived from ledger entries for the user’s accounts.
- **Relations:** User → LedgerAccount(s). User is the owner of those accounts for authorization and display.

---

### LedgerAccount

- **Purpose:** A bookkeeping account in the double-entry ledger. Holds a logical balance that is **only ever derived** from the sum of **LedgerEntry** rows for this account.
- **Attributes (conceptual):** `account_id`, `user_id` (owner; null for system accounts), `currency`, `account_type` (e.g. user_wallet | system_float | fee | provider_float), `created_at`. No `balance` column; balance = SUM(entries) for this account.
- **Relations:** LedgerAccount has many LedgerEntry rows. Belongs to a User when it is a user wallet.
- **System accounts:** Used for float, fees, and provider positions; `user_id` null, `account_type` identifies role.

---

### LedgerTransaction

- **Purpose:** A single, atomic double-entry transaction. Groups two or more **LedgerEntry** rows that together sum to zero (balanced).
- **Attributes (conceptual):** `transaction_id`, `idempotency_key` (optional but required for API-originated writes), `reason` or `type` (e.g. transfer_in | transfer_out | conversion | fee | adjustment | reversal), `created_at`, optional reference to external id (e.g. conversion_id, provider_transfer_id).
- **Relations:** LedgerTransaction has one or more LedgerEntry rows. Each entry references one LedgerAccount and one LedgerTransaction.
- **Invariant:** Sum of all entries in the transaction is zero (see Section 2).

---

### LedgerEntry

- **Purpose:** One side of a double-entry line: a single debit or credit to one **LedgerAccount**, as part of one **LedgerTransaction**.
- **Attributes (conceptual):** `entry_id`, `transaction_id`, `account_id`, `amount` (signed: e.g. positive = credit, negative = debit, by convention), `currency`, `created_at`. Optional: `metadata` (e.g. reference to Quote or ProviderEvent).
- **Relations:** Belongs to one LedgerTransaction and one LedgerAccount.
- **Invariant:** Ledger is append-only; entries are never updated or deleted. Reversals are new entries in a new transaction.

---

### Quote

- **Purpose:** An offered rate or terms for a **Conversion** (e.g. amount in currency A → amount in currency B, or send amount + fee). Valid for a limited time.
- **Attributes (conceptual):** `quote_id`, `user_id` (optional), `from_currency`, `to_currency`, `from_amount` or `to_amount` (depending on quote direction), `rate` or derived amounts, `expires_at`, `created_at`. Optional: fee breakdown.
- **Relations:** Quote can be used by at most one Conversion (one-time use). Conversion references `quote_id` if it was created from a quote.
- **Invariant:** A Conversion may only use a Quote if `now < expires_at` at the time of execution (see Section 2).

---

### Conversion

- **Purpose:** Execution of a conversion (e.g. currency A → B). Results in a **LedgerTransaction** with debits and credits across the involved **LedgerAccount**(s).
- **Attributes (conceptual):** `conversion_id`, `user_id`, `quote_id` (optional; null if no quote was used), `from_account_id`, `to_account_id`, `from_amount`, `to_amount`, `fee_amount` (if any), `status` (e.g. pending | completed | failed | reversed), `idempotency_key`, `created_at`, `completed_at`.
- **Relations:** Conversion references one LedgerTransaction (the double-entry that performed the conversion). Optionally references one Quote. Ties to LedgerAccounts for from/to.
- **Invariant:** Once completed, the corresponding LedgerTransaction is immutable. Reversals create a new transaction and optionally update Conversion status to reversed.

---

### ProviderEvent

- **Purpose:** Raw, untrusted payload from an external provider (e.g. webhook). Persisted before any processing; then verified and deduped. Drives internal events and thus **LedgerTransaction**/LedgerEntry when applicable.
- **Attributes (conceptual):** `provider_event_id` (our id), `provider` (provider name or id), `provider_event_id_external` (provider’s id for dedupe), `payload` (raw JSON or blob), `received_at`, `status` (pending | processed | rejected | dead_letter), `processed_at`, optional `ledger_transaction_id` or internal event id after processing.
- **Relations:** When processed, may result in one or more LedgerTransactions. No FK from ledger to ProviderEvent required; link via metadata or audit if needed.
- **Invariant:** At most one logical processing per (provider, provider_event_id_external); duplicate events do not create duplicate ledger entries (see Section 2).

---

### Spend

- **Purpose:** A user-initiated outbound movement of value (e.g. payment, transfer out, or card spend). Represents the intent and outcome of “sending” value out of a user’s **LedgerAccount**.
- **Attributes (conceptual):** `spend_id`, `user_id`, `account_id`, `amount`, `currency`, `idempotency_key`, `status` (e.g. pending | completed | failed | reversed), `destination` (opaque or structured, e.g. external account or merchant), `ledger_transaction_id` (the double-entry that debited the user), `created_at`, `completed_at`. Optional: reference to provider transfer id.
- **Relations:** Spend results in one LedgerTransaction (at least one debit from user’s account). May tie to ProviderEvent when provider confirms settlement.
- **Invariant:** Only one Spend per idempotency_key; same key returns same Spend and does not create a second debit (see Section 2).

---

## 2. Invariants (Summary)

These rules are non-negotiable. The system must enforce them in code and in schema (where applicable).

### 2.1 Append-only ledger

- **LedgerEntry** and **LedgerTransaction** rows are never updated or deleted after insert.
- Corrections and reversals are implemented by appending new transactions and new entries (e.g. reversal entries that net to zero with the original).
- Balance for any **LedgerAccount** is always:  
  `balance(account_id) = SUM(entries.amount) WHERE account_id = ?`

---

### 2.2 Balanced transactions

- For every **LedgerTransaction**, the sum of all **LedgerEntry** amounts for that transaction is zero:  
  `SUM(entry.amount) FOR transaction_id = T = 0`
- So every debit has a matching credit (or multiple credits/debits that net to zero). The books never create or destroy value within a transaction.

---

### 2.3 Balance derivation only from entries

- **LedgerAccount** has no `balance` column that is written by application logic.
- Balances are always computed from **LedgerEntry** (and optionally cached/denormalized for read performance, with the cache derived from entries and invalidated when new entries are appended). The canonical source of truth is the entry table.

---

### 2.4 Quote expiry

- A **Quote** is valid only while `current_time < quote.expires_at`.
- A **Conversion** that references a **Quote** may only be executed (and ledger written) if, at the moment of execution, the quote has not expired. If the quote has expired, the conversion must be rejected (e.g. “quote expired”) and no ledger entries created for that quote.

---

### 2.5 Idempotency of writes

- Any API or internal operation that creates **LedgerTransaction** and **LedgerEntry** rows must be keyed by an idempotency key (e.g. `Idempotency-Key` header or equivalent).
- For a given idempotency key (scoped per endpoint and per user/client):  
  - First request: process and persist the transaction and entries; store the result keyed by the idempotency key.  
  - Subsequent requests with the same key: return the same result and **do not** create a second transaction or duplicate entries.
- Applies to: **Spend**, **Conversion**, and any other write that mutates the ledger. **ProviderEvent** processing is idempotent by (provider, provider_event_id_external), not by client idempotency key.

---

### 2.6 ProviderEvent processing at most once per external id

- For a given (provider, provider_event_id_external), at most one successful processing that creates or updates ledger state.
- Duplicate webhooks (same provider + provider_event_id_external) must be detected (e.g. unique constraint or lookup before processing). Duplicates are acknowledged without creating new **LedgerTransaction** or **LedgerEntry** rows.

---

### 2.7 Economic truth equation (global invariant)

- Sum of all user account balances (derived from entries) + system/float/fee positions = sum of provider-side positions (or settled outflows) + pending movements.  
- No value is created or destroyed; every credit has a matching debit elsewhere. This is maintained by balanced transactions (2.2) and append-only ledger (2.1).

---

## 3. Entity relationship (high level)

```
User 1 ──* LedgerAccount
LedgerAccount * ──* LedgerEntry  * ──1 LedgerTransaction
LedgerTransaction 1 ──* LedgerEntry

Quote 0..1 ──1 Conversion  ──1 LedgerTransaction
User ──* Conversion
LedgerAccount (from/to) ──* Conversion

User ──* Spend  ──1 LedgerTransaction
LedgerAccount ──* Spend

ProviderEvent (processed) ──0..1 LedgerTransaction (via worker / internal event)
```

---

*Document owner: engineering. Update when adding entities or changing invariants.*
