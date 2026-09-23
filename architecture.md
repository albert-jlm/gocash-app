# Architecture

> This document is maintained by Claude. Update it after adding major features or reaching new milestones.
> Last updated: 2026-09-23

---

## Status as of 2026-09-23

**This document describes a mix of current and target state, and is being corrected
mid-rebuild on `feature/ledger-rebuild`.** Read alongside:

- `AUDITS.md` — Audit **#5** (full review) and **#5a** (live homelab verification; corrects #5)
- `~/.claude/plans/i-think-the-whole-async-sparrow.md` — the approved rebuild plan

Sections below marked **TARGET** describe intended behaviour that the code contradicts
today. The largest such gap: **the confirmation gate does not exist.**

---

## System Overview

GoCash App is a self-contained cross-platform mobile application (Next.js + Capacitor) with no external workflow engine dependency. Operators capture payment screenshots; the app processes them via Supabase Edge Functions (OCR + AI + fee calc).

**TARGET:** the app then presents an in-app confirmation screen *before* applying any balance change.

**CURRENT:** it does not. `supabase/functions/main/_process_transaction.ts` writes
`status: "confirmed"` and moves balances in the same request, and
`main/_confirm_transaction.ts` rejects any transaction that is not already
`confirmed`/`edited` — it has become an *edit* endpoint. Restoring the gate is Phase 1.2
of the plan.

The backend runs on a **dedicated 5-service Supabase stack** on the homelab
(`~/homelab/gocash/docker-compose.yml`), not on the shared instance — see *Hosting* below.

---

## Folder Structure

```
/
├── app/                    — Next.js App Router pages (static export)
├── components/             — Shared UI components (Shadcn/ui based)
├── supabase/
│   ├── functions/
│   │   ├── _core/                 — Shared domain logic: money.ts, postings.ts,
│   │   │                            fees.ts, types.ts (+ tests). Deno-compatible,
│   │   │                            imported by Next.js via tsconfig path alias
│   │   └── main/                  — The single served edge function (routes inside):
│   │                                _process_transaction.ts, _confirm_transaction.ts,
│   │                                _delete_transaction.ts
│   └── migrations/                — Now includes the captured production baseline
├── docs/                   — Project documentation and feature specs
├── .ai/prompts/            — AI role prompts for Claude/Codex
├── PRD.md                  — Product Requirements Document (v3.0)
├── TECH_SPEC.md            — Technical Specification
└── CLAUDE.md               — Project memory for Claude
```

---

## Key Components

| Component | Description | Location |
|---|---|---|
| PWA Client | Next.js static export — camera, upload, confirmation, dashboard | `app/` |
| Domain Core | Integer-centavo money, the six posting shapes, fee resolution, detection | `supabase/functions/_core/` |
| Edge Fn: process-transaction | Phase 1 — receives image, runs OCR (GPT-4o), calls core logic, writes to DB. **Currently also confirms and moves balances** | `supabase/functions/main/_process_transaction.ts` |
| Edge Fn: confirm-transaction | **TARGET** Phase 2 — posts one balanced ledger entry. **Currently** an edit endpoint for already-confirmed rows | `supabase/functions/main/_confirm_transaction.ts` |
| Supabase Auth | Operator login (email + magic link) | Supabase project |
| Transaction DB | PostgreSQL + RLS — all transaction records | Supabase |
| Wallet DB | PostgreSQL + RLS — GCash, MariBank, Maya, Cash wallet rows. **Being dropped** — replaced by `accounts` + `postings` with balances derived via the `account_balances` view | Supabase |
| Fee Rules DB | PostgreSQL + RLS — `transaction_rules` (delta multipliers) today; **being replaced** by effective-dated `fee_rules` (`rate_bps`, `minimum_minor`) | Supabase |
| Supabase Storage | Stores original transaction screenshots | Supabase |
| ~~Supabase Realtime~~ | **Not used and being dropped.** Documented here for six months as a core dependency; `grep` for `.channel(` / `.subscribe()` across `src/` returns nothing. Balance updates are refresh-on-navigate | — |
| Capacitor Shell | Wraps Next.js static export for iOS/Android native distribution | Capacitor |

---

## Data Flow

### Phase 1 — Transaction Processing

1. Operator captures/selects screenshot in the PWA
2. App uploads image to Supabase Storage (authenticated)
3. App calls `process-transaction` Edge Function with the storage path
4. Edge Function: GPT-4o OCR → classify platform/type → calculate fee → extract account → gpt-4.1-mini date/ref extraction → upsert to `transactions` table (**TARGET** status: `awaiting_confirm`; **CURRENT**: writes `confirmed` and moves balances here)
5. Edge Function returns `{ transaction_id, platform, type, amount, profit, account, reference }`
6. PWA navigates to Confirmation screen pre-filled with AI-extracted data

### Phase 2 — Confirmation Gate (**TARGET** — does not exist today)

7. Operator reviews and optionally edits transaction fields in-app
8. Operator taps "Confirm" → PWA calls `confirm-transaction` Edge Function
9. Edge Function: resolve the effective `fee_rules` row → build the balanced postings for
   the type → insert one `ledger_entries` row + its `postings` atomically (idempotency key)
   → set status `confirmed`
10. Dashboard re-reads `account_balances` on navigation

**CURRENT:** step 4 already writes `status: "confirmed"` and applies the balance change, so
steps 7–9 never gate anything. `confirm-transaction` edits an already-confirmed row via the
live 18-argument `confirm_transaction_atomic` reversal RPC. See AUDITS #5a.

---

## Database Schema

See TECH_SPEC.md Section 4.2 for the full SQL DDL.

**Live today** (7 tables — the repo's migrations produced only 5 until the 2026-09-23
baseline capture; see AUDITS #5a):

```
operators               — Tenant table
transactions            — All transaction records
wallets                 — GCash / MariBank / Maya / Cash balances per operator
transaction_rules       — Delta multipliers per transaction type per operator
audit_logs              — Written by the live audit_transactions trigger
operator_platforms      — Per-operator platform list (replaced the platform CHECK)
receipt_deletion_queue  — Exists with the right shape; nothing enqueues into it yet
```

**TARGET** (added by `20260924000001_ledger_tables.sql` and `..._fee_rules.sql`):

```
accounts          — cash / platform / revenue / equity, per operator, currency-tagged
ledger_entries    — one per confirmed transaction; append-only
postings          — signed integer-centavo legs; must sum to zero (DEFERRABLE trigger)
account_balances  — view; derived balances (security_invoker = true)
fee_rules         — effective-dated rate_bps + minimum_minor; GiST exclusion on overlap
```

`wallets`, `update_wallet_balance`, `confirm_transaction_atomic`, both
`delete_transaction_atomic` overloads and `initialize_operator_defaults` are dropped.

> `operator_devices` was listed here for six months and **has never existed** in any
> database. It is a push-notification table from the TECH_SPEC's Phase 2 wishlist
> (TECH_SPEC §7.5) that was never created.

Key constraint: `UNIQUE (operator_id, reference_number)` on `transactions` — deduplication key. Live, this exists twice (`unique_reference_per_operator` and `transactions_unique_reference_per_operator`); the duplicate is to be dropped.

---

## Hosting — Dedicated GoCash Stack

**Superseded:** this section previously described a shared-schema strategy — one
`supabase.zether.net` instance hosting all apps, GoCash isolated only by a `gocash`
PostgreSQL schema sharing `auth.users` with MagoHQ. That approach is no longer the plan.

GoCash runs on its **own trimmed Supabase stack**, `~/homelab/gocash/docker-compose.yml`,
with **five services only**:

| Service | Why |
|---|---|
| `db` | Postgres 15 — the ledger |
| `rest` | PostgREST |
| `auth` | GoTrue — **its own `auth.users`**, which was the isolation goal |
| `storage` | Receipts |
| `functions` | Deno edge runtime |

No Kong (the existing Traefik routes `/rest/v1`, `/auth/v1`, `/storage/v1`,
`/functions/v1`), no analytics/vector, no studio/meta, no pooler, no imgproxy, and no
realtime. That is roughly 485 MiB versus ~2.3 GiB for a stock stack — the box has
~6 GiB available and swap already 80% full.

New JWT secret and new anon/service keys — MagoHQ's are not reused.

**Why the shared instance was abandoned:** shared `auth.users` was the isolation gap, and
every one of the six `SECURITY DEFINER` functions on the shared instance was executable
with the public anon key and no session (AUDITS #5a, finding 1). The old `gocash` schema
stays running untouched until cutover, so rollback is repointing the app at the old URL.

**Supabase client for GoCash** (still schema-scoped):
```typescript
const supabase = createClient(url, anonKey, {
  db: { schema: 'gocash' }
})
```

---

## External Services & Integrations

| Service | Purpose | Notes |
|---|---|---|
| Supabase | Auth, Database, Storage, Edge Functions | Core backend — entire stack. Realtime not used |
| OpenAI GPT-4o | Screenshot OCR (vision) | Called from `process-transaction` Edge Function |
| OpenAI gpt-4.1-mini | Date + reference number extraction | Called from `process-transaction` Edge Function |
| Capacitor | iOS + Android native shell | Wraps Next.js static export |
| APNs + FCM | Push notifications | Phase 2 feature |

---

## Environment Variables

### Client (Next.js — public, safe to expose)
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |

### Supabase Edge Functions (server-side only, never in client)
| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key — OCR + extraction |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for bypassing RLS in Edge Functions |

---

## Known Constraints & Technical Decisions

- **Two-phase write model is sacred** — **TARGET, currently violated.** Balances must never
  update without explicit operator confirmation. Today `_process_transaction.ts` moves them
  in the same request as the OCR. Restoring this is Phase 1.2.
- **Cash In direction** (operator-confirmed, authoritative): the customer hands over **cash**
  and receives e-money. Drawer cash goes **UP** by amount + fee, the platform wallet goes
  **DOWN** by amount, revenue goes up by the fee. PRD FR-21, TECH_SPEC §4.2,
  `settings/rules/page.tsx` and `onboarding/page.tsx` all state the inverse; they are wrong.
- **Fee model**: `ceil(max(amount × 2%, PHP 5))` for all six types. No bracket ladder.
  (Implementation nuance: the ceiling is applied to Cash In and Cash Out only; other types
  keep centavo precision. A known, deliberate deviation that preserves live behaviour.)
- **The books must balance**: every ledger entry's postings sum to zero, enforced by a
  `DEFERRABLE INITIALLY DEFERRED` trigger. Balances are derived, never mutated in place.
- **Static export required**: `next.config.js` uses `output: 'export'`. No SSR, no Next.js API routes. All backend logic is in Supabase Edge Functions (Deno). This keeps the app fully distributable via Capacitor.
- **OpenAI is server-side only**: API key lives in Supabase Edge Function env vars. Never exposed to the client.
- **One shared core, two runtimes**: business logic lives in `supabase/functions/_core/`
  (Deno-compatible, zero runtime deps), imported by the Edge Functions directly and by
  Next.js via a tsconfig path alias. The old `src/lib/transaction-processing.ts` was a
  copy-paste that diverged from the deployed copy, and its 37 tests exercised code that
  never ran in production. It is being deleted.
- **RLS on every table**: All Supabase tables use Row Level Security. Operators only access
  their own data. Every UPDATE policy needs a `WITH CHECK` — live, none of them have one.
- **Multi-tenant SaaS is the target**, not single-tenant. Tenant-safe architecture
  (nothing hardcoded to one operator) is Phase 2; billing is deferred until someone asks
  to pay.
- **Receipt retention**: receipts are kept N days, then purged. They contain customers'
  mobile numbers held on behalf of other operators — a PH Data Privacy Act obligation. The
  `receipt_deletion_queue` table exists; nothing enqueues into it and no scheduler runs the
  cleanup. See PRD FR-27.
