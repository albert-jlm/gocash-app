# Threat Model — [Feature Name]

> Copy this file to `docs/threat-models/[feature-name].md` for each Heavy Mode feature.
> Required for: auth, payments, user data, file uploads, external APIs, webhooks, multi-tenant boundaries.

**Feature:** [feature name]
**Date:** [YYYY-MM-DD]
**Author:** [your name / Claude]
**Status:** Draft | Approved | Implemented

---

## 1. Assets

What data or systems are we protecting?

| Asset | Sensitivity | Owner |
|-------|------------|-------|
| [e.g., User PII] | High | Users |
| [e.g., Payment records] | Critical | Finance |
| [e.g., Auth tokens] | High | Auth system |

---

## 2. Actors

| Actor | Trust Level | Description |
|-------|------------|-------------|
| Authenticated user | Medium | Logged-in, verified user |
| Anonymous user | Low | Unauthenticated visitor |
| Admin | High | Internal operator |
| External service | Variable | Webhooks, third-party APIs |
| Attacker | None | Malicious actor, may be authenticated |

---

## 3. Entry Points

Where can data enter the system?

- `POST /api/[route]` — [description]
- File upload at `[endpoint]` — [accepted types, max size]
- Webhook from `[service]` — [payload format]
- [add more as needed]

---

## 4. Trust Boundaries

Where does execution cross from one trust level to another?

- User input → database (validate before write)
- External webhook → internal queue (verify HMAC before processing)
- Public API → tenant data (enforce tenant isolation on every query)
- [add boundaries specific to this feature]

---

## 5. Threats & Mitigations

Use STRIDE: **S**poofing, **T**ampering, **R**epudiation, **I**nfo Disclosure, **D**enial of Service, **E**levation of Privilege

| # | Threat | STRIDE | Likelihood | Impact | Mitigation | Status |
|---|--------|--------|-----------|--------|-----------|--------|
| T1 | [e.g., Attacker replays auth token] | S | Medium | High | Short token TTL + refresh rotation | ⬜ Planned |
| T2 | [e.g., User accesses another tenant's data] | E | High | Critical | Tenant ID enforced in every DB query | ⬜ Planned |
| T3 | [e.g., Malicious file upload executes code] | T | Low | Critical | Type check + AV scan + presigned URL | ⬜ Planned |
| T4 | [add your threats] | | | | | |

**Status key:** ⬜ Planned | 🔄 In Progress | ✅ Implemented | ⚠️ Accepted Risk

---

## 6. Accepted Risks

Risks we have consciously decided not to mitigate (with justification):

| Risk | Reason Accepted | Review Date |
|------|----------------|------------|
| [e.g., No rate limit on internal API] | Internal network only, VPN required | [date] |

---

## 7. Validation Checklist

Before this feature ships:
- [ ] All T1-Tn mitigations are implemented and tested
- [ ] OWASP security review completed (see `.ai/prompts/security-reviewer.md`)
- [ ] Secrets audit passed
- [ ] Auth/authz verified in staging with real user accounts
- [ ] Accepted risks reviewed and signed off
