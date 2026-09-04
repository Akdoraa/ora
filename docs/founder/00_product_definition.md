# ORA — Product Definition (Founder Reference)

Internal reference only. Not for marketing or external use.

---

## 1. What ORA Is and Is Not

**ORA is:**
- A **money-movement platform**: moving value (fiat and/or permitted instruments) through a **ledger** and **provider integrations**.
- **Ledger-first**: Balances and positions are always derived from an append-only double-entry ledger. There is no “balance field” that gets updated directly.
- **Provider-mediated**: Actual settlement and banking rails are behind a **BankingAdapter** abstraction; ORA does not hold a banking licence nor become the direct custodian of user funds at the bank.
- **Deterministic and auditable**: Every write is idempotent; every credit/debit has a counterparty and a reason. The system can be reconciled and explained.

**ORA is not:**
- A **bank**: We do not take deposits in the regulatory sense; we orchestrate movement via licensed providers.
- A **speculation or trading product**: ORA is about moving and holding cash-like value for defined use cases, not market-making or trading P&L.
- A **black box**: Balance and history are not “as reported by provider only”; they are derived from our own ledger, with provider events used as verified, deduped inputs to that ledger.
- A **marketing-led product**: Features that conflict with ledger integrity, user protection, or the economic truth equation below are out of scope.

---

## 2. Core Economic Truth Equation

The system must satisfy a single, non-negotiable economic invariant:

**Sum of all user ledger balances + system/float positions + fees accrued = Sum of all provider-side positions (or settled outflows) + pending (in-flight) movements.**

In other words:
- **No value is created or destroyed inside ORA.**  
- Every credit to a user (or to system) has a matching debit somewhere (another user, system float, provider, or fee account).  
- The books always balance; reconciliation against provider statements is possible and required.

Implications:
- **Fees** are explicit ledger entries (debit user/position, credit fee account), not implicit “spread” that might double-count.
- **Float** (e.g. funds in transit or at provider) is a first-class position on the ledger, not hidden.
- **Settlement failures or reversals** are reflected as ledger entries (reversals, adjustments) so the equation holds before and after.

Any feature or “optimization” that obscures this equation or allows balance derivation to bypass the ledger is forbidden.

---

## 3. Who Structurally Wins and Loses

**Users (holders of value on the platform):**
- **Win**: Predictable movement of funds, clear history, and protections (warnings, fiat routing clarity). They benefit from correct, auditable books and from not being exposed to hidden risk (e.g. rehypothecation, opaque fees).
- **Lose**: If we misrepresent balances, hide fees, or route fiat in ways that contradict what we show or promise—or if we prioritize growth over ledger integrity and protection.

**ORA (platform):**
- **Wins**: Sustainable economics only when fees are explicit, ledger is correct, and we do not take risk we don’t design for (e.g. no unbacked ledger positions).
- **Loses**: If we allow “balance by provider only” to override the ledger, or introduce direct balance updates, we lose auditability and user trust; regulatory and operational risk increase.

**Providers (banks, processors):**
- **Win**: Clear, idempotent instructions; reconciliation and dispute resolution are straightforward because our ledger matches our requests and their responses.
- **Lose**: If we send inconsistent or non-idempotent instructions, or if our view of the world diverges from theirs without a clear audit trail.

**Design rule:** Do not design flows where one party’s structural win requires another’s hidden loss (e.g. user loss from hidden fees or undisclosed fiat routing). Prefer explicit, ledger-reflected flows.

---

## 4. Required User Protections

### 4.1 Warnings

- **Before irreversible money movement**: Users must see a clear warning that value will leave their control (e.g. withdrawal, send, or conversion), with amount and destination (or destination type) stated.
- **Before first use of a risky path**: Any flow that is not “standard” (e.g. unusual routing, or a provider with different guarantees) must be called out so the user can opt in knowingly.
- **When provider or system fails**: Users must not be left with a UI that implies success when the ledger or provider state is uncertain; show a clear “pending” or “failed” state and next steps, not a false “success.”

Warnings are part of the product contract; they are not optional “nice-to-haves” for launch.

### 4.2 Fiat routing

- **Disclosure**: Users must be able to understand, in plain terms, where their fiat is going (e.g. which provider, which account type, which jurisdiction) when they fund or withdraw.
- **Consistency**: What we show (in UI or in statements) must match what the ledger and provider integrations do. No “marketing” routing that differs from actual settlement path.
- **Traceability**: Every fiat-relevant movement must be represented on the ledger so that “show me where my money went” is answerable from our data (with provider references where needed).

Fiat routing rules and disclosures must be defined per product flow and reviewed when new providers or paths are added.

---

## 5. Non-Negotiable Truths and Assumptions

**Ledger and balances**
- Balances are always derived from ledger entries. No direct balance updates.
- Double-entry, append-only. Every entry has a counterparty and a clear reason.
- Idempotent writes (Idempotency-Key) on all write endpoints so we can safely retry and reconcile.

**Provider and external input**
- Provider webhooks and callbacks are **untrusted input**. We verify, dedupe, and persist raw events; we do not trust them to be the sole source of truth for our ledger.
- Our ledger remains the source of truth; provider data is used to confirm, correct, or dispute—not to replace the ledger.

**Economics**
- The economic truth equation (Section 2) holds at all times. No feature may violate it.
- Fees and float are first-class ledger concepts, not side effects.

**User protection**
- Warnings before irreversible movement and for non-standard or risky paths are required.
- Fiat routing must be disclosed and consistent with actual movement; traceability is required.

**Assumptions we rely on**
- Providers will expose (or we can infer) enough information to reconcile our ledger with their state.
- We will not hold a banking licence; we depend on licensed providers for actual funds movement and custody where required.
- Users and regulators will hold us accountable for correctness and transparency; the product must be built to withstand that accountability.

---

*Document owner: founder. Update when the core product scope or economic model changes.*
