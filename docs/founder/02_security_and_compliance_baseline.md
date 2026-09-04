# ORA — Security and Compliance Baseline

Reference for threat model, controls, logging rules, and operational security. Aligns with OWASP practices and project non-negotiables.

---

## 1. Threat Model (Top Risks)

Risks are ordered by impact and likelihood for a money-movement platform. Controls in Section 2 map to these.

| Risk | Description | Mitigation focus |
|------|-------------|------------------|
| **Ledger integrity** | Unauthorized or incorrect ledger entries (credits without debits, direct balance tampering, or bypassing double-entry). | Append-only ledger; no direct balance updates; all writes idempotent and audited; code path that writes ledger is narrow and tested. |
| **Duplicate or replayed money movement** | Same transfer executed twice via duplicate API calls or replayed webhooks. | Idempotency-Key on all write endpoints; provider events deduped by provider event id before driving ledger; idempotent processing in worker. |
| **Webhook spoofing or tampering** | Attacker sends fake or modified webhooks to trigger credits or state changes. | Treat webhooks as untrusted; verify (signature, provider API) before any ledger write; persist raw payload for forensics; no trust-by-IP alone. |
| **Credential and secret exposure** | API keys, signing secrets, or DB credentials leaked (logs, repo, config). | Secrets only in env / secret manager; never log secrets or tokens; least-privilege provider keys; rotate on suspicion. |
| **Abuse and DoS** | Excessive or malicious traffic to exhaust resources or obscure real attacks. | Rate limits on API (per client/user); rate limits or quotas on webhook ingestion; backpressure and timeouts. |
| **Insider or compromised service** | Privileged access used to create fraudulent entries or exfiltrate data. | Audit logs for all ledger writes and sensitive actions; separation of duties; minimal PII in logs; alert on anomalous patterns. |
| **Data exposure (PII/financial)** | User or transaction data leaked via logs, errors, or responses. | Logging rules (no PII); error responses sanitized; access to audit and DB restricted and logged. |

**Out of scope for this baseline:** Jurisdiction-specific regulatory compliance (e.g. licensing, data residency). Those are documented separately and drive additional controls.

---

## 2. Controls

### 2.1 Idempotency

- **All write endpoints** (transfers, adjustments, any operation that changes ledger or provider state) **require** an `Idempotency-Key` header (or equivalent) and are implemented so that the same key results in at most one logical effect.
- **Server-side behavior:** First request with key K → process and store result keyed by K. Subsequent requests with K → return the same response (and do not re-execute).
- **Key format:** Client-provided, opaque; recommend UUID or similar. Key scope is per endpoint and per client/user (so two different users can use the same key without collision).
- **Retention:** Store idempotency result long enough to cover retry windows (e.g. 24–72 hours); after that, duplicate requests may be rejected or treated as new.
- **Provider events:** Dedupe by (provider, provider_event_id) before creating internal events or ledger entries. Re-processing the same provider event must not create duplicate ledger entries.

Idempotency prevents duplicate money movement and supports safe retries; it is non-negotiable.

### 2.2 Rate Limits

- **API (public):**
  - Apply rate limits per client (API key or authenticated user) and optionally per endpoint.
  - Write endpoints: stricter limits (e.g. lower requests/minute) than read-only.
  - Return `429 Too Many Requests` with `Retry-After` when exceeded; do not log full request bodies.
- **Webhooks:**
  - Limit rate of accepted webhook requests per provider (and optionally per endpoint) to avoid overload and to give time to detect abuse.
  - Prefer accepting and persisting raw payload first, then processing async; if overloaded, persist and defer processing rather than dropping.
- **Internal services:** Optional rate limits or backpressure between worker and ledger/DB to protect downstream. Prefer queue depth and circuit breakers over hard global limits.

Document limits (e.g. N req/min per user for writes) and review when changing provider or traffic patterns.

### 2.3 Audit Logs

- **What to audit:**
  - **Ledger:** Every append (entry id, account(s), amount, reason/type, idempotency key if any, timestamp, actor/service that initiated).
  - **Sensitive actions:** Auth events (login, token issue/revoke), permission changes, access to bulk or sensitive data exports.
  - **Provider events:** Acceptance of webhook (provider, event id, received_at); processing outcome (processed / rejected / dead-letter).
- **What not to put in audit logs:** Full request/response bodies that may contain PII or payment details; secrets; raw card numbers or full account numbers. Use stable ids and minimal, typed fields.
- **Retention and access:** Retain audit logs per policy (e.g. 1 year minimum for ledger-related); store in a dedicated store or partition; access is restricted and itself logged.
- **Integrity:** Prefer append-only audit sink; do not alter or delete audit records. Correlation id should link API request → worker run → ledger append for traceability.

Audit logs support incident response, compliance, and reconciliation; they are not a substitute for application logging (Section 3) but complement it.

---

## 3. Logging Rules (No PII)

- **Never log:** Passwords, API keys, tokens, session secrets, full payment instruments (e.g. full card or account numbers), or any field that directly identifies a natural person (e.g. full name, email, address) unless required by a dedicated, compliant audit trail and clearly separated from application logs.
- **Safe to log (examples):** Request method and path (with path params normalized if they contain ids); response status; duration; correlation id; internal ids (user id, account id, ledger entry id, provider event id); error codes or short error types; service name and version. For errors, log type and context (e.g. "validation_failed", "provider_timeout") but not user-supplied content that might be PII.
- **Structured format:** JSON (or equivalent) with consistent field names (e.g. `correlation_id`, `event`, `level`, `ts`). Every request should have a correlation id propagated to worker and downstream so that a single flow can be traced.
- **Levels:** Use standard levels (e.g. debug, info, warn, error). Do not log at debug in production for high-volume paths; reserve debug for troubleshooting with explicit enablement.
- **Log aggregation:** Application logs and audit logs should be separable (different streams or tags) so that PII policies and retention can be applied correctly. Application logs must remain PII-free so they can be used for monitoring and debugging without special handling.

Any new log field must be checked against this rule; when in doubt, log an internal id or type, not raw user or payment data.

---

## 4. Operational Basics

### 4.1 Monitoring

- **Availability:** Health checks for API and worker (e.g. `/health`, queue consumer lag). Alert when unhealthy or lag exceeds threshold.
- **Money movement:** Alerts on repeated transfer failures, webhook processing failures, or dead-letter growth. Alert on reconciliation drift (e.g. ledger sum vs provider balance) when reconciliation runs.
- **Security and abuse:** Alert on spike in 4xx/5xx, auth failures, or rate-limit hits. Optional: anomaly on high-value or unusual transfer patterns (to be tuned to avoid false positives).
- **Dependencies:** Monitor provider API latency and errors; DB connection pool and query latency. Circuit breakers or fallbacks where appropriate.
- **Metrics:** Emit metrics for request counts, latency percentiles, ledger append count, and worker processing rate. Use correlation id in logs; avoid high-cardinality user-supplied values in metric dimensions.

Runbooks for each alert (what to check, who to involve, how to mitigate) should be documented and kept up to date.

### 4.2 Incident Response

- **Severity levels (example):**
  - **Critical:** Active loss of funds, ledger corruption, or full outage of money movement. Immediate response; involve lead engineer and product/legal as needed.
  - **High:** Significant degradation (e.g. one provider failing, or delayed processing). Response within SLA (e.g. within hours).
  - **Medium:** Non-critical failures, elevated errors, or security concern with no confirmed impact. Response within 24 hours.
  - **Low:** Minor issues, planned maintenance. Track and fix in normal cycle.
- **Steps:** Detect (monitoring/alerts or report) → Triage (severity, scope) → Contain (e.g. disable a flow, revert, or scale) → Resolve (fix and verify) → Post-incident (blameless review, update runbooks, close gaps).
- **Communication:** Define who is notified per severity and how (e.g. Slack, PagerDuty). For user-impacting or funds-related incidents, define when and how to notify users or partners and who approves.
- **Evidence:** Preserve logs and audit trail for security or funds-related incidents; do not alter or delete during or immediately after the incident.

Document ownership (who is on-call, who escalates) and keep contact information current.

---

*Document owner: engineering / security. Update when adding integrations, changing data handling, or after significant incidents.*
