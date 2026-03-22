# Architecture

> This document is maintained by Claude. Update it after adding major features or reaching new milestones.
> Last updated: 2026-03-22

---

## System Overview

GoCash App is a fully self-contained cross-platform mobile application (Next.js + Capacitor) with no external workflow engine dependency. Operators capture payment screenshots; the app processes them via Supabase Edge Functions (OCR + AI + profit calc), then presents an in-app confirmation screen before applying wallet balance changes. The entire stack is Supabase + OpenAI — deployable without any homelab infrastructure.

---

## Folder Structure

```
/
├── src/app/                — Next.js App Router pages (static export)
├── src/components/         — Shared UI components (Shadcn/ui based)
├── src/lib/                — Client/shared helpers (platforms, filters, notifications)
├── supabase/
│   └── functions/
│       ├── _shared/transaction-processing.ts — Shared business logic
│       ├── _shared/storage.ts                — Private storage path helpers
│       ├── process-transaction/              — Phase 1: image upload + GPT-4o + DB write
│       └── confirm-transaction/              — Phase 2: platform validation + wallet updates
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
| PWA Client | Next.js static export — camera, upload, confirmation, dashboard | `src/app/` |
| Shared Processing Logic | Classify platform/type, profit calc, account extraction, wallet deltas | `supabase/functions/_shared/transaction-processing.ts` |
| Edge Fn: process-transaction | Phase 1 — receives base64 image, stores it privately, runs GPT-4o extraction, writes draft tx | `supabase/functions/process-transaction/` |
| Edge Fn: confirm-transaction | Phase 2 — validates platform against active catalog, computes wallet deltas, updates balances atomically | `supabase/functions/confirm-transaction/` |
| Supabase Auth | Operator login (email + magic link) | Supabase project |
| Transaction DB | PostgreSQL + RLS — all transaction records | Supabase |
| Platform Catalog DB | PostgreSQL + RLS — active/inactive built-in + custom platforms per operator | Supabase |
| Wallet DB | PostgreSQL + RLS — platform/cash wallets with color + active state | Supabase |
| Tx Rules DB | PostgreSQL + RLS — delta multipliers per transaction type and platform | Supabase |
| Supabase Storage | Stores original transaction screenshots | Supabase |
| Supabase Realtime | Live wallet + transaction status sync to PWA | Supabase |
| Capacitor Shell | Wraps Next.js static export for iOS/Android native distribution | Capacitor |

---

## Data Flow

### Phase 1 — Transaction Processing

1. Operator captures/selects screenshot in the PWA
2. App sends the base64 image to `process-transaction`
3. Edge Function stores the image in private Supabase Storage
4. Edge Function runs a single GPT-4o extraction call → classify platform/type → calculate profit → extract account → insert draft transaction (status: `awaiting_confirm`)
5. Edge Function returns `{ transaction_id, platform, type, amount, profit, account, reference }`
6. PWA navigates to Confirmation screen pre-filled with AI-extracted data

### Phase 2 — Confirmation Gate

7. Operator reviews and optionally edits transaction fields in-app
8. Operator taps "Confirm" → PWA calls `confirm-transaction` Edge Function
9. Edge Function: validate platform against active `operator_platforms` → look up `transaction_rules` → compute wallet deltas → update `wallets` atomically → set status `confirmed` or `edited`
10. Supabase Realtime pushes updated wallet balances to dashboard

---

## Database Schema

See TECH_SPEC.md Section 4.2 for the full SQL DDL.

```
operators           — Tenant table (id = auth.uid())
operator_platforms  — Canonical platform catalog per operator
transactions        — All transaction records (two-phase write model)
wallets             — Platform / cash balances per operator, with color + active state
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
| OpenAI GPT-4o | Screenshot OCR + structured extraction | Called from `process-transaction` Edge Function |
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
| `TELEGRAM_BOT_TOKEN` | Telegram Bot token used for processed / processing-error alerts |

---

## Known Constraints & Technical Decisions

- **Two-phase write model is sacred**: Wallet balances must never update without explicit operator confirmation.
- **Static export required**: `next.config.js` uses `output: 'export'`. No SSR, no Next.js API routes. All backend logic is in Supabase Edge Functions (Deno). This keeps the app fully distributable via Capacitor.
- **OpenAI is server-side only**: API key lives in Supabase Edge Function env vars. Never exposed to the client.
- **Business logic in `supabase/functions/_shared/transaction-processing.ts`**: Shared TypeScript used by both Edge Functions and Vitest.
- **RLS on every table**: All Supabase tables use Row Level Security. Operators only access their own data.
- **Single-tenant first, multi-tenant schema**: Milestone 1 is single-operator. RLS + `operator_id` FK is designed in from day one to avoid a rewrite for multi-tenancy.
