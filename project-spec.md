# Project Spec

> **The full Technical Specification is at [TECH_SPEC.md](TECH_SPEC.md).**

This project uses `TECH_SPEC.md` as the canonical engineering specification. It covers the full stack design, database schema, API flows, and infrastructure plan.

> ⚠️ **Status as of 2026-09-23 — mid-rebuild.** TECH_SPEC's schema and business-logic
> sections describe the superseded multiplier model. The n8n migration it describes
> completed in March 2026; n8n is no longer part of the pipeline. See `AUDITS.md`
> #5/#5a and `~/.claude/plans/i-think-the-whole-async-sparrow.md` for what is actually
> being built.

---

## Part 1: Product Requirements

See [`PRD.md`](PRD.md) for the full product requirements.

**Goal:** Build an alpha/MVP to ship — replace the Telegram confirmation gate with a native mobile app.

**Target Users:** Philippine e-wallet agents managing daily GCash/Maya/MariBank transactions. **The target is multi-tenant SaaS.** Tenant-safe architecture (nothing hardcoded to one operator) is in scope now; billing and self-serve signup are deferred until someone asks to pay.

---

## Part 2: Engineering Requirements

### 2.0 Stack Audit

**Stack Decision Record:** `docs/stack-decision-record.md`
**Audited on:** (run `/stack-audit`)
**Stack approved:** [ ] Yes

---

### 2.1 Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Type safety across full stack |
| Frontend Framework | Next.js 15 (App Router, static export) | Static export required for Capacitor; no SSR |
| Native Shell | Capacitor | Single codebase → iOS + Android |
| Styling | Tailwind CSS | Utility-first, mobile-first |
| Component Library | Shadcn/ui | Accessible, customizable |
| Backend | Supabase | Auth + DB + RLS + Storage + Edge Functions. **Realtime dropped** — verified zero usage in `src/` |
| Database | PostgreSQL (Supabase) | Relational; RLS handles multi-tenancy |
| Auth | Supabase Auth | Email + 6-digit OTP (the UI copy still says "magic link"; the flow verifies an OTP) |
| AI Pipeline | Supabase Edge Functions (Deno) + OpenAI SDK | Self-contained; no external workflow engine |
| AI Models | GPT-4o (OCR) + gpt-4.1-mini (extraction) | Called from Edge Functions only |
| Hosting | Dedicated 5-service Supabase stack (`~/homelab/gocash/docker-compose.yml`) + static export (frontend) | `db`, `rest`, `auth`, `storage`, `functions`; Traefik routes, no Kong. **Not** the shared `supabase.zether.net` instance |
| Monitoring | Sentry | Error tracking from day one |

---

### 2.2 System Architecture Overview

Static PWA with a native Capacitor shell. Next.js is a pure static export (no SSR, no API routes). Supabase handles everything backend: auth, data, and the AI processing pipeline via Edge Functions. Capacitor wraps the static app for iOS/Android distribution. OpenAI is called from Edge Functions only — never from the client. Balance changes reach the UI on navigation/refetch, not by push.

See [`architecture.md`](architecture.md) for the full component diagram and data flow.

---

### 2.3 Database Schema (Draft)

See [`architecture.md`](architecture.md) — Database Schema section.

Key tables today: `transactions`, `wallets`, `transaction_rules`.

> A table named `tx_rules` has never existed — that name was wrong in every version of
> this doc. The real table is `transaction_rules`, and it is being replaced by
> `gocash.fee_rules` (effective-dated, `rate_bps` + `minimum_minor`). `wallets` is being
> dropped entirely in favour of derived balances over `accounts` / `ledger_entries` /
> `postings`.

---

### 2.4 API Design

No Next.js API routes — backend is Supabase Edge Functions:

```
Supabase Edge Functions (called via Supabase client SDK):
  process-transaction    — Upload image + Phase 1 (OCR → classify → fee → DB write)
                           TARGET: writes status 'awaiting_confirm', NO ledger entry
  confirm-transaction    — Phase 2: apply edits, then post one balanced ledger entry
  void-transaction       — TARGET: reversal entry, status 'voided', enqueue receipt deletion
  amend-transaction      — TARGET: reversal + new entry; both retained

Supabase DB (accessed directly from client via Supabase SDK + RLS):
  SELECT transactions       — List/filter transactions
  SELECT account_balances   — Current balances (derived view; replaces SELECT wallets)
```

> **Current vs. target.** Live `process-transaction` writes `status: "confirmed"` and
> moves balances in the same request, and `confirm-transaction` is an edit endpoint that
> rejects anything not already confirmed. `void-transaction` and `amend-transaction` do
> not exist yet. The gate above is the restored design, not today's behaviour.
>
> There is no `REALTIME wallets` subscription and never was — balance updates are
> refresh-on-navigate.

---

### 2.5 Infrastructure Checklist

- [ ] Supabase project created
- [ ] Supabase tables + RLS policies applied (see TECH_SPEC.md Section 4.2 for full DDL)
- [ ] Supabase Edge Functions deployed (`process-transaction`, `confirm-transaction`)
- [ ] OpenAI API key added to Supabase Edge Function secrets
- [ ] GitHub repo created and pushed
- [ ] `.env` filled with Supabase URL + anon key

---

### 2.6 Other Technical Notes

- **Two-phase write model must be restored** — see PRD.md Section 3.1. It is not in force today.
- **Operator blacklist numbers** — the operator's own mobile numbers, never recorded as a
  customer account number. These were previously written out in full in this file; they are
  deliberately not reproduced here. They are hardcoded in the OCR prompt and shared logic
  today and move to a `gocash.operator_numbers` table in Phase 2 of the rebuild.
- **Reference number is the dedup key** — `UNIQUE (operator_id, reference_number)` exists
  live as `unique_reference_per_operator` (indexed twice; the duplicate is to be dropped).
- **Receipt retention** — screenshots contain customers' mobile numbers held on behalf of
  other operators. Receipts are kept N days then purged; this is a PH Data Privacy Act
  obligation and needs a written retention policy. See PRD FR-27.

> The old n8n webhook ID that lived here has been removed: that workflow no longer
> processes GoCash transactions, and the ID was dead.
