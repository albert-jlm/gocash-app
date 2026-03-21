# Architecture

> This document is maintained by Claude. Update it after adding major features or reaching new milestones.
> Last updated: 2026-03-21

---

## System Overview

GoCash App is a fully self-contained cross-platform mobile application (Next.js + Capacitor) with no external workflow engine dependency. Operators capture payment screenshots; the app processes them via Supabase Edge Functions (OCR + AI + profit calc), then presents an in-app confirmation screen before applying wallet balance changes. The entire stack is Supabase + OpenAI — deployable without any homelab infrastructure.

---

## Folder Structure

```
/
├── app/                    — Next.js App Router pages (static export)
├── components/             — Shared UI components (Shadcn/ui based)
├── lib/
│   └── transaction-processing.ts  — Business logic (classify, profit calc, account extraction)
├── supabase/
│   └── functions/
│       ├── process-transaction/   — Phase 1: OCR + AI + DB write
│       └── confirm-transaction/   — Phase 2: wallet balance updates
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
| Transaction Processing Logic | Classify platform/type, profit calc, account extraction | `lib/transaction-processing.ts` |
| Edge Fn: process-transaction | Phase 1 — receives image, runs OCR (GPT-4O), calls processing logic, writes to DB | `supabase/functions/process-transaction/` |
| Edge Fn: confirm-transaction | Phase 2 — applies confirmation, computes wallet deltas, updates balances | `supabase/functions/confirm-transaction/` |
| Supabase Auth | Operator login (email + magic link) | Supabase project |
| Transaction DB | PostgreSQL + RLS — all transaction records | Supabase |
| Wallet DB | PostgreSQL + RLS — GCash, MariBank, Cash wallet rows | Supabase |
| Tx Rules DB | PostgreSQL + RLS — delta multipliers per transaction type | Supabase |
| Supabase Storage | Stores original transaction screenshots | Supabase |
| Supabase Realtime | Live wallet + transaction status sync to PWA | Supabase |
| Capacitor Shell | Wraps Next.js static export for iOS/Android native distribution | Capacitor |

---

## Data Flow

### Phase 1 — Transaction Processing

1. Operator captures/selects screenshot in the PWA
2. App uploads image to Supabase Storage (authenticated)
3. App calls `process-transaction` Edge Function with the storage path
4. Edge Function: GPT-4O OCR → classify platform/type → calculate profit → extract account → gpt-4.1-mini date/ref extraction → upsert to `transactions` table (status: `awaiting_confirm`)
5. Edge Function returns `{ transaction_id, platform, type, amount, profit, account, reference }`
6. PWA navigates to Confirmation screen pre-filled with AI-extracted data

### Phase 2 — Confirmation Gate

7. Operator reviews and optionally edits transaction fields in-app
8. Operator taps "Confirm" → PWA calls `confirm-transaction` Edge Function
9. Edge Function: look up `tx_rules` → compute `deltaPlatform` + `deltaCash` → update `wallets` → write `starting_cash` + `wallet_balance` snapshots to transaction → set status `confirmed` or `edited`
10. Supabase Realtime pushes updated wallet balances to dashboard

---

## Database Schema

See TECH_SPEC.md Section 4.2 for the full SQL DDL.

```
operators           — Tenant table (id = auth.uid())
transactions        — All transaction records (two-phase write model)
wallets             — GCash / MariBank / Cash balances per operator
transaction_rules   — Delta multipliers per transaction type per operator
operator_devices    — Push notification tokens (Phase 2)
```

Key constraint: `UNIQUE (operator_id, reference_number)` on `transactions` — deduplication key.

---

## Multi-App Schema Strategy

One Supabase instance hosts all apps. Each app gets its own **PostgreSQL schema** — a namespace that completely isolates its tables, functions, and triggers.

```
supabase.zether.net (one instance)
├── auth.*          ← shared — all apps use the same auth.users
├── storage.*       ← shared — buckets are prefixed by app (e.g. gocash-images)
├── public.*        ← reserved (Supabase internals)
├── gocash.*        ← GoCash app tables, functions, triggers
└── [next_app].*    ← next app gets its own schema
```

**To add a new app:**
```sql
CREATE SCHEMA new_app;
GRANT USAGE ON SCHEMA new_app TO anon, authenticated, service_role;
-- then add 'new_app' to PGRST_DB_SCHEMAS in ~/homelab/supabase/.env
-- and restart: docker compose restart rest
```

**Supabase client for GoCash** (schema-scoped):
```typescript
const supabase = createClient(url, anonKey, {
  db: { schema: 'gocash' }
})
```

**PostgREST config** (`~/homelab/supabase/.env`):
```
PGRST_DB_SCHEMAS=public,storage,graphql_public,gocash
```

---

## External Services & Integrations

| Service | Purpose | Notes |
|---|---|---|
| Supabase | Auth, Database, Storage, Realtime, Edge Functions | Core backend — entire stack |
| OpenAI GPT-4O | Screenshot OCR (vision) | Called from `process-transaction` Edge Function |
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

- **Two-phase write model is sacred**: Wallet balances must never update without explicit operator confirmation.
- **Static export required**: `next.config.js` uses `output: 'export'`. No SSR, no Next.js API routes. All backend logic is in Supabase Edge Functions (Deno). This keeps the app fully distributable via Capacitor.
- **OpenAI is server-side only**: API key lives in Supabase Edge Function env vars. Never exposed to the client.
- **Business logic in `lib/transaction-processing.ts`**: Shared TypeScript — imported by Edge Functions, unit-testable with Vitest, no Node.js dependencies.
- **RLS on every table**: All Supabase tables use Row Level Security. Operators only access their own data.
- **Single-tenant first, multi-tenant schema**: Milestone 1 is single-operator. RLS + `operator_id` FK is designed in from day one to avoid a rewrite for multi-tenancy.
