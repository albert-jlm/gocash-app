# GoCash App

AI-powered transaction tracker for Philippine e-wallet agents (GCash/Maya/MariBank). Captures payment screenshots, extracts transaction data via OCR (GPT-4o), calculates the operator's fee automatically, and tracks wallet balances.

**Current phase:** Mid-rebuild on `feature/ledger-rebuild` — replacing the multiplier-based balance model with a double-entry ledger and restoring the confirmation gate.

> ⚠️ **The confirmation gate is a target, not current behaviour.** The live
> `process-transaction` writes `status: "confirmed"` and moves balances in the same
> request; `confirm-transaction` has become an edit endpoint. Restoring the gate is
> Phase 1 of the rebuild. See `AUDITS.md` #5/#5a and
> `~/.claude/plans/i-think-the-whole-async-sparrow.md`.

---

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 15 (App Router, static export) |
| Native Shell | Capacitor (iOS + Android) |
| Styling | Tailwind CSS + Shadcn/ui |
| Backend | Supabase (Auth + PostgreSQL + RLS + Storage) — **no Realtime** (see below) |
| AI Pipeline | Supabase Edge Functions (Deno) + OpenAI (GPT-4o OCR + gpt-4.1-mini) |
| Hosting | Static export (frontend) + dedicated 5-service Supabase stack at `~/homelab/gocash/docker-compose.yml` |

> **n8n and Vercel are both gone.** n8n was removed from the AI pipeline in March 2026;
> the frontend is a static export, not a Vercel deployment. n8n survives in the plan only
> as the scheduler for receipt-retention cleanup (Phase 2).
>
> **Supabase Realtime was never used.** It is documented across these docs as a core
> dependency, but `grep` for `.channel(` / `.subscribe()` across `src/` finds nothing.
> It is being dropped from the new stack; balance updates are refresh-on-navigate.

---

## Quick Start

> App scaffolding in progress. See [TECH_SPEC.md](TECH_SPEC.md) for the target architecture.

```bash
pnpm install
pnpm dev
```

---

## Documentation

| Doc | Purpose |
|-----|---------|
| [PRD.md](PRD.md) | Product requirements — what and why |
| [TECH_SPEC.md](TECH_SPEC.md) | Technical specification — how |
| [architecture.md](architecture.md) | System design and component overview |
| [project-status.md](project-status.md) | Milestones and current progress |
| [changelog.md](changelog.md) | Running log of changes |
| [AUDITS.md](AUDITS.md) | Audit history, gate results, and follow-up actions |
| [HUMAN_GUIDE.md](HUMAN_GUIDE.md) | Human-in-the-loop workflow guide |
| [docs/workflow.md](docs/workflow.md) | Vibe coding workflow reference |

---

## Workflow

```
/stack-audit    ← validate tech stack before building
/vibe-code      ← start every feature session
/update-docs    ← sync docs after each feature
/create-issues  ← convert spec to GitHub issues
/retro          ← milestone retrospective
```
