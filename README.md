# GoCash App

AI-powered transaction tracker for GoCash/MariBank operators. Captures payment screenshots, extracts transaction data via OCR (GPT-4O), calculates commissions automatically, and tracks wallet balances — with a mandatory human confirmation gate before any balance changes.

**Current phase:** Building the cross-platform mobile app (Next.js + Capacitor) to replace the Telegram confirmation workflow.

---

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 15 (App Router) |
| Native Shell | Capacitor (iOS + Android) |
| Styling | Tailwind CSS + Shadcn/ui |
| Backend | Supabase (Auth + PostgreSQL + RLS + Realtime + Storage) |
| AI Pipeline | n8n (existing workflow — GPT-4O OCR + gpt-4.1-mini) |
| Hosting | Vercel (frontend) + Homelab (n8n) |

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
