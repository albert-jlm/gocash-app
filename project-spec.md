# Project Spec

> **The full Technical Specification is at [TECH_SPEC.md](TECH_SPEC.md).**

This project uses `TECH_SPEC.md` (v2.1) as the canonical engineering specification. It covers the full stack design, database schema, API flows, infrastructure plan, and migration strategy from n8n Data Tables to Supabase.

---

## Part 1: Product Requirements

See [`PRD.md`](PRD.md) for the full product requirements.

**Goal:** Build an alpha/MVP to ship — replace the Telegram confirmation gate with a native mobile app.

**Target Users:** GoCash operators managing daily GCash/MariBank transactions (single operator in MVP, multi-operator in Phase 2).

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
| Backend | Supabase | Auth + DB + RLS + Realtime + Storage + Edge Functions |
| Database | PostgreSQL (Supabase) | Relational; RLS handles multi-tenancy |
| Auth | Supabase Auth | Email + magic link |
| AI Pipeline | Supabase Edge Functions (Deno) + OpenAI SDK | Self-contained; no external workflow engine |
| AI Models | GPT-4O (OCR) + gpt-4.1-mini (extraction) | Called from Edge Functions only |
| Hosting | Supabase (backend) + CDN/static host (frontend) | No server required for frontend |
| Monitoring | Sentry | Error tracking from day one |

---

### 2.2 System Architecture Overview

Static PWA with a native Capacitor shell. Next.js is a pure static export (no SSR, no API routes). Supabase handles everything backend: auth, data, realtime, and the AI processing pipeline via Edge Functions. Capacitor wraps the static app for iOS/Android distribution. OpenAI is called from Edge Functions only — never from the client.

See [`architecture.md`](architecture.md) for the full component diagram and data flow.

---

### 2.3 Database Schema (Draft)

See [`architecture.md`](architecture.md) — Database Schema section.

Key tables: `transactions`, `wallets`, `tx_rules`

---

### 2.4 API Design

No Next.js API routes — backend is Supabase Edge Functions:

```
Supabase Edge Functions (called via Supabase client SDK):
  process-transaction    — Upload image + trigger Phase 1 (OCR → classify → profit → DB write)
  confirm-transaction    — Trigger Phase 2 (wallet delta → update wallets → write snapshots)

Supabase DB (accessed directly from client via Supabase SDK + RLS):
  SELECT transactions    — List/filter transactions
  SELECT wallets         — Get current wallet balances
  REALTIME wallets       — Live balance updates
```

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

- **Two-phase write model must be preserved** — see PRD.md Section 3.1
- **n8n webhook ID**: `1O6ul5VKOzqPwtOD` — update this workflow to write to Supabase instead of n8n Data Tables
- **Operator blacklist numbers**: `09757058698`, `13246870917` — handled in n8n, verify they carry over to Supabase writes
- **Reference number is the dedup key** — Supabase upsert must use `reference_number` + `operator_id` as the unique constraint
