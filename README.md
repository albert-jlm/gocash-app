# GoCash App

AI-powered transaction tracker for GoCash operators. It captures payment screenshots, extracts transaction data with GPT-4o, stores the original image in private Supabase Storage, and updates wallet balances only after an in-app human confirmation step.

**Current phase:** Milestone 1 app flow is implemented. Audit #5 remediation is landed: operator platform catalog, private screenshot storage, wallet colors, realtime refresh, and transaction search/filter improvements are in place.

---

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 15 (App Router) |
| Native Shell | Capacitor (iOS + Android) |
| Styling | Tailwind CSS + Shadcn/ui |
| Backend | Supabase (Auth + PostgreSQL + RLS + Realtime + Storage) |
| AI Pipeline | Supabase Edge Functions + OpenAI GPT-4o |
| Hosting | Static export + Capacitor bundles + GitHub Actions deploy |

---

## Quick Start

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Notes:
- `pnpm typecheck` runs `next typegen` first so route types are generated before `tsc`.
- The transaction screenshot bucket is private. Images are rendered in-app through short-lived signed URLs.

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
/vibe-code      ← start every feature session
/update-docs    ← sync docs after each feature
/create-issues  ← convert spec to GitHub issues
/retro          ← milestone retrospective
```
