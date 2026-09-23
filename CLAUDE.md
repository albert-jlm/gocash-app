# CLAUDE.md — Project Memory

> This file is always included in context. Keep it focused and concise. Link to other docs instead of duplicating content.

---

## Project Overview

**Project Name:** GoCash App
**Goal:** Ship a cross-platform mobile app (Next.js + Capacitor) replacing the Telegram confirmation gate; evolve into multi-tenant SaaS serving multiple Philippine e-wallet agents (GCash/Maya/MariBank)
**Current Milestone:** Ledger rebuild (`feature/ledger-rebuild`) — see `AUDITS.md` #5/#5a and `~/.claude/plans/i-think-the-whole-async-sparrow.md`

> ⚠️ **The docs in this repo are being corrected mid-rebuild.** Several long-standing
> claims are false: the confirmation gate does not exist, Realtime was never used, and
> the Cash In direction is written backwards in the PRD, TECH_SPEC and two UI files.
> Where this file says **TARGET**, the code contradicts it today.

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
| Backend / Auth | Supabase (Auth + PostgreSQL + RLS + Storage). **Realtime is not used** — verified zero `.channel(`/`.subscribe()` call sites in `src/`; being dropped from the new stack |
| AI Pipeline | Supabase Edge Functions (Deno) + OpenAI SDK (GPT-4o + gpt-4.1-mini) |
| Hosting (Frontend) | Static export — no server required |
| Hosting (Backend) | Dedicated 5-service Supabase stack: `~/homelab/gocash/docker-compose.yml` |
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
- **Two-phase write model** — **TARGET, not current.** A transaction should be saved as a
  draft (Phase 1), and balances should only move after operator confirmation (Phase 2).
  Today `main/_process_transaction.ts` writes `status: "confirmed"` and moves balances in
  the same request; `main/_confirm_transaction.ts` rejects anything not already confirmed
  and is effectively an edit endpoint. Restoring the gate is Phase 1.2 of the plan.
- **Cash In direction** (operator-confirmed, authoritative): the customer hands over
  **CASH** and receives e-money → drawer cash **UP** by amount + fee, platform wallet
  **DOWN** by amount, revenue up by the fee. `PRD.md` FR-21, `TECH_SPEC.md` §4.2,
  `src/app/settings/rules/page.tsx` and `src/app/onboarding/page.tsx` state the **inverse**.
  Those are wrong. Cash Out is the mirror, except the fee is *deducted*:
  platform +amount, cash −(amount − fee), revenue −fee.
- **Fee model**: `ceil(max(amount × 2%, PHP 5))` for **all six types**. There is no bracket
  ladder and no per-type formula — the three different formulas in `PRD.md` and
  `TECH_SPEC.md` (including a PHP 5 Telco ladder) are fiction.
  *Implementation nuance:* `_core/fees.ts` applies the ceiling to Cash In and Cash Out
  only; other types keep centavo precision. A known, deliberate deviation preserving live
  behaviour. Cash Out also carries a gross-amount heuristic (receipt already includes the
  fee) for whole-peso bases above PHP 250.
- **The books must balance**: postings are signed integer centavos summing to zero per
  entry, enforced by a `DEFERRABLE INITIALLY DEFERRED` trigger. Balances are derived from
  `account_balances`, never mutated in place.
- **Transaction Types**: Cash In, Cash Out, Telco Load (auto-detected in
  `process-transaction`), Bills Payment, Bank Transfer, Profit Remittance (manual). These
  collapse to three posting shapes: `customer_pays_cash` (the first four and Telco/Bills/
  Bank), `customer_pays_emoney` (Cash Out), `equity_draw` (Profit Remittance).
  **Direction is not operator-configurable** — that is exactly what the multiplier columns
  were, and it is why four of six types were destroying money in production.
- **Platforms**: GCash, MariBank, Maya, Unknown. Custom platforms live in
  `operator_platforms`. The `Unknown → "GCash"` fallback is being dropped — `Unknown`
  means the gate asks.
- **Wallets tracked**: GCash, MariBank, Maya, Cash. `wallets` as a table is being dropped
  in favour of `accounts` (`cash` / `platform` / `revenue` / `equity`).
- **Status value**: the live CHECK constraint uses **`awaiting_confirm`**, not
  `awaiting_confirmation`. `PRD.md` and parts of `TECH_SPEC.md` use the wrong spelling.
- **Operator blacklist numbers**: the operator's own mobile numbers, never recorded as a
  customer account number. **Deliberately not written out here** — they were previously
  listed in full in this file, `project-spec.md`, `PRD.md` and `TECH_SPEC.md`. They are
  hardcoded in the OCR prompt and shared logic today; Phase 2 moves them to
  `gocash.operator_numbers` with the exit criterion "zero references anywhere in the
  codebase".
- **Receipt retention**: receipts are kept N days, then purged. They hold customers'
  mobile numbers on behalf of other operators — PH Data Privacy Act applies, and there is
  no retention policy document anywhere in the repo yet.
- **All amounts in PHP (Philippine Peso)**, stored as integer centavos in TypeScript.
- **OpenAI is called server-side only** — inside Supabase Edge Functions. Never call OpenAI from the client.

---

## Hosting — Dedicated GoCash Stack

**Superseded:** this section previously described the shared-schema approach — one
`supabase.zether.net` instance for all projects, GoCash isolated only by a `gocash`
PostgreSQL schema and sharing `auth.users` with MagoHQ. That is no longer the plan.

GoCash gets its **own trimmed Supabase stack** at `~/homelab/gocash/docker-compose.yml`:
`db`, `rest`, `auth`, `storage`, `functions` — five services, ~485 MiB. No Kong (Traefik
routes `/rest/v1`, `/auth/v1`, `/storage/v1`, `/functions/v1`), no analytics, no studio,
no pooler, no imgproxy, no realtime. New JWT secret and new anon/service keys; MagoHQ's
are not reused. Its own `auth.users` was the isolation goal.

The JS client stays schema-scoped: `createClient(url, key, { db: { schema: 'gocash' } })`.

The old `gocash` schema on the shared instance stays running untouched until cutover.

---

## Constraints & Policies

- Never push directly to the `main` branch
- Always use environment variables for secrets — never hardcode them
- Always run tests before marking a task as done
- Follow the existing folder structure and naming conventions
- Secrets never appear in code, logs, or prompts
- Auth/authz is explicit — never assumed
- **RLS policies are required on every Supabase table** — no public access without an explicit policy. **Every UPDATE policy needs a `WITH CHECK`**; live, not one has one, so a client can update a row it owns and set `operator_id` to another tenant's.
- **No `gocash` function may be EXECUTE-able by `anon` or `authenticated`.** Six `SECURITY DEFINER` functions were callable with the public anon key and no session (AUDITS #5a). Edge Functions use the service-role key and need no grant. CI asserts this generically.
- **Balance changes only happen after confirmation** — **TARGET, currently violated.** Never auto-commit balance changes. The one sanctioned exception is `operators.settings.auto_confirm_below_minor`, which defaults to 0 (off).
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
