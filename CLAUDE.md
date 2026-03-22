# CLAUDE.md — Project Memory

> This file is always included in context. Keep it focused and concise. Link to other docs instead of duplicating content.

---

## Project Overview

**Project Name:** GoCash App
**Goal:** Ship a cross-platform mobile app (Next.js + Capacitor) replacing the Telegram confirmation gate; evolve into multi-tenant SaaS serving multiple GoCash/MariBank operators
**Current Milestone:** Milestone 1 — Cross-Platform App (PWA + iOS + Android)

---

## Key References

- 📋 PRD: `PRD.md`
- 📐 Tech Spec: `TECH_SPEC.md`
- 🏗️ Architecture: `architecture.md`
- 📝 Changelog: `changelog.md`
- 📊 Project Status: `project-status.md`
- 🔄 Vibe Coding Workflow: `docs/workflow.md`

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 15 (App Router) |
| Native Shell | Capacitor (iOS + Android) |
| Styling | Tailwind CSS |
| Component Library | Shadcn/ui |
| Backend / Auth | Supabase (Auth + PostgreSQL + RLS + Realtime + Storage) |
| AI Pipeline | Supabase Edge Functions (Deno) + OpenAI SDK (GPT-4O + gpt-4.1-mini) |
| Hosting (Frontend) | Static export — no server required |
| Push Notifications | APNs (iOS) + FCM (Android) — Phase 2 |

---

## Design & UX Guidelines

- **Style:** Clean, minimal, mobile-first, dark mode default
- **Component Library:** Shadcn/ui
- **CSS Framework:** Tailwind CSS
- **Tone/Voice:** Simple and clear — operators are running a small business, not tech-savvy
- **Primary Platform:** Mobile (PWA → iOS/Android). Desktop is secondary.

---

## Vibe Coding Workflow

**Run `/vibe-code` at the start of each session** to get guided through the workflow.
**See [HUMAN_GUIDE.md](HUMAN_GUIDE.md) for the complete human-in-the-loop guide.**

Mode routing:
- **Light Mode** (UI tweaks, small changes, scripts): spec → plan → implement → verify
- **Heavy Mode** (new features, auth, data, APIs, AI): spec → threat-model → plan → implement → security-review → verify

Rules:
- No code before `spec.md` exists in `docs/specs/[feature]/`
- No merge before `verification.md` is complete
- Heavy Mode is required for: auth, payments, user PII, file uploads, webhooks, AI integrations
- One slice at a time — never implement "the whole feature" at once
- Use **Codex** for slice execution; use **Claude Code** for planning, review, and security passes

## Skills Available in This Project

| Skill | When to Use |
|-------|------------|
| `/stack-audit` | Before starting — validates tech stack, writes `docs/stack-decision-record.md` |
| `/vibe-code` | Start of every feature session |
| `/update-docs` | After each feature — syncs architecture.md, changelog.md, project-status.md |
| `/create-issues` | After planning — converts spec into GitHub issues |
| `/retro` | End of each milestone — improves this CLAUDE.md and workflow |

Prompt templates: `.ai/prompts/` (planner, implementer, reviewer, security-reviewer)
Workflow reference: `docs/workflow.md`
Human guide: `HUMAN_GUIDE.md`

---

## Domain Knowledge

Key business facts Claude must always know:
- **Immediate save model**: Transactions are processed and saved immediately as "confirmed" with wallet balance updates applied atomically. There is no approval/confirmation gate.
- **Edit & Delete**: Saved transactions can be edited (wallet deltas are reversed then reapplied) or deleted (wallet deltas are reversed and the record is removed). Both operations go through atomic PL/pgSQL functions.
- **Transaction Types**: Cash In, Cash Out, Telco Load (auto-detected in `process-transaction` Edge Function), Bills Payment, Bank Transfer, Profit Remittance (manual)
- **Platforms**: GCash, MariBank, Maya, Unknown (operators can add custom platforms)
- **Wallets tracked**: GCash wallet, MariBank wallet, Maya wallet, Cash wallet
- **Operator blacklist numbers**: `09757058698`, `13246870917` — never recorded as customer account numbers
- **All amounts in PHP (Philippine Peso)**
- **OpenAI is called server-side only** — inside Supabase Edge Functions. Never call OpenAI from the client.

---

## Multi-App Supabase Strategy

One self-hosted Supabase instance (`supabase.zether.net`) serves all projects using **PostgreSQL schemas** for isolation:
- Each app gets its own schema: `gocash`, `next_app`, etc.
- `auth.*` is shared — one set of users across all apps
- The Supabase JS client is scoped per app: `createClient(url, key, { db: { schema: 'gocash' } })`
- New schemas must be added to `PGRST_DB_SCHEMAS` in `~/homelab/supabase/.env` and `docker compose restart rest`

---

## Constraints & Policies

- Never push directly to the `main` branch
- Always use environment variables for secrets — never hardcode them
- Always run tests before marking a task as done
- Follow the existing folder structure and naming conventions
- Secrets never appear in code, logs, or prompts
- Auth/authz is explicit — never assumed
- **RLS policies are required on every Supabase table** — no public access without an explicit policy
- **Wallet balance updates happen atomically** when a transaction is processed, edited, or deleted — always through PL/pgSQL RPC functions
- **Next.js must stay as static export** (`output: 'export'`) — no SSR, no API routes; all backend logic goes in Supabase Edge Functions
- **Never call OpenAI from the client** — always via Edge Functions; API key lives in Supabase env vars only

---

## Repository Etiquette

- Use a new branch for each feature: `feature/[feature-name]`
- Bug fixes: `fix/[bug-name]`
- Branch naming: lowercase, hyphenated
- Commit messages: conventional commits — `feat(scope): description` / `fix(scope): description`
- PR description must link to `docs/specs/[feature]/spec.md` and list verification status
- Submit a PR against `main` when a feature is complete — do not merge directly

---

## Frequently Used Commands

```bash
# Install dependencies
pnpm install

# Run dev server
pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build

# Lint
pnpm lint

# Type check
pnpm typecheck

# Sync Capacitor (after web build)
npx cap sync
```

---

## Testing Instructions

- Run unit tests after any logic change
- Run the full test suite before submitting a PR
- For front-end changes, visually verify in the browser using Playwright MCP if available
- For Capacitor changes, test on Android emulator before merging

---

## Additional Rules

- [Add rules here as the project evolves]
- Use the `#` shortcut to add new rules on the fly during sessions
- Every codebase audit must append a dated entry to `AUDITS.md` (scope, gate results, findings, follow-ups)
