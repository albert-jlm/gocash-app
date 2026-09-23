# Project Status

> Tracks milestones, progress, and where we left off.
> Maintained by Claude. Update at the end of every session or after completing a feature.

---

## Current Status

**Active Milestone:** Ledger Rebuild (`feature/ledger-rebuild`)
**Overall Progress:** 🔴 **Not feature-complete.** The UI shell is built; the money model
underneath it is being replaced and the product's stated core premise — the confirmation
gate — does not exist.

> **Correction (2026-09-23).** This file claimed "🟢 Feature-complete — all screens, native
> shell, share intent, tests done". Audits #5 and #5a contradict most of that:
>
> | Claimed | Actual |
> |---|---|
> | Feature-complete | 4 of 6 transaction types post the wrong balance changes in production |
> | Confirmation gate shipped | Does not exist — `_process_transaction.ts` confirms and moves balances in one request |
> | 37 tests passing | They passed against `src/lib/transaction-processing.ts`, a diverged copy that **never ran in production** |
> | Wallet management screen ✅ Done | Selected a `wallets.color` column the repo migrations never created (live has it; the repo did not) |
> | Platform management ✅ Done | Deleting a platform silently did nothing — no DELETE policy existed, so 0 rows affected returned success |
> | Supabase schema ✅ Done (5 tables) | Production had **7 tables, 9 functions, 6 triggers, 18 indexes**, built by hand. The repo's migrations reproduced none of it |
> | "All High/Medium findings resolved" | False — see *Where We Left Off* |

Scale in production: **2 operators, 8 wallets, 1 transaction.** Dormant since March. This
is the cheapest this change will ever be.

---

## Milestones

### 🔄 Milestone 0 — Ledger Rebuild (active)

**Goal:** A ledger that cannot silently lose money, a confirmation gate that actually
gates, a schema a second operator can be onboarded into, and a repo that is once again the
source of truth.

Plan: `~/.claude/plans/i-think-the-whole-async-sparrow.md`. Findings: `AUDITS.md` #5, #5a.

#### Commits on this branch

| Commit | Description |
|---|---|
| `eb7f86f` | `chore(supabase): reconcile repo with production, close the anon RPC hole` — captured the live schema as `20260923000000_baseline_gocash.sql`; added `20260923000001_revoke_public_execute.sql` and `20260923000002_default_privileges.sql` |
| `c16164c` | `feat(core): double-entry posting rules in integer centavos` — `supabase/functions/_core/` (`money.ts`, `postings.ts`, `fees.ts`, `types.ts`) + tests. One source, two runtimes |
| `acef102` | `feat(db): ledger tables and effective-dated fee rules` — `20260924000001_ledger_tables.sql`, `20260924000002_fee_rules.sql` |
| `962f1cd` | `fix(ledger): close five holes found in review` |

#### Phase status

| Phase | Work | Status |
|---|---|---|
| 0 | Anon RPC hole, CORS lockdown, capture production into the repo, dedicated 5-service stack | 🔄 In progress — stack file exists at `~/homelab/gocash/docker-compose.yml` (db, rest, auth, storage, functions) |
| 1 | Ledger tables + restore the gate + golden receipt set | 🔄 In progress — core logic and migrations landed; **the gate itself is not yet restored** |
| 1.5 | Golden receipt set (~20 real screenshots, all six types) | ⬜ Not started — **must not slip**; the OCR has no accuracy measurement and it *is* the product |
| 2 | Tenant safety: `operator_numbers`, `platform_catalog`, plans/metering, receipt retention | ⬜ Not started |
| 4 | Durability: fix the offsite backup, verify a restore | ⬜ Not started — **hard gate before Phase 3** |
| 3 | Self-serve signup + billing (PayMongo) | ⬜ Deferred until someone asks to pay |

#### Open critical items

| Item | Severity | Notes |
|---|---|---|
| Confirmation gate does not exist | Critical | `_process_transaction.ts` writes `status: "confirmed"` and moves balances in the same request |
| 4 of 6 transaction types post wrong | Critical | Telco Load −95, Bills Payment −95, Bank Transfer −100 on a ₱100 transaction; Profit Remittance records a cash-in |
| Repo seeds inverted Cash In/Cash Out rules | High | `onboarding/page.tsx:245` — any operator onboarded with current repo code gets backwards rules |
| No RLS `WITH CHECK` on any UPDATE policy | High | A client can update a row it owns and set `operator_id` to another tenant |
| Offsite backup has never succeeded | High | 33 consecutive nightly `restic copy` failures; one SSD; no restore ever tested |
| No receipt retention / privacy policy | High | Receipts hold customers' mobile numbers; PH Data Privacy Act. Nothing enqueues into `receipt_deletion_queue` and no scheduler runs |
| Live CORS is `*` | Medium | A regression against Audit #4's "CORS restricted" claim; the repo's allowlist was never deployed |
| OCR accuracy unmeasured | Medium | Tuned against one operator's receipts; blocks selling to operator #3 |
| `pnpm run lint` still interactive | Low | No `eslint.config.*`. Open since Audit #1 |

---

### 🔄 Milestone 1 — Cross-Platform Standalone App (**not complete**)
**Goal:** A fully self-contained mobile app (iOS + Android + PWA) that replaces the n8n/Telegram workflow entirely. Operators upload screenshots, AI processes them, they review and save — done.
**Target Date:** TBD

#### Foundation
| Task | Status | Notes |
|---|---|---|
| PRD rewritten as standalone app spec (v4.0) | ✅ Done | n8n/Telegram FRs removed |
| TECH_SPEC updated (v3.0) | ✅ Done | Full Edge Function spec |
| architecture.md updated | ✅ Done | n8n removed; multi-app schema strategy documented |
| CLAUDE.md updated | ✅ Done | Static export constraint, Edge Function pipeline |
| Supabase `gocash` schema + RLS | ⚠️ Misreported | The repo's migrations produced 5 tables / 2 functions / 0 triggers / 0 indexes. **Production had 7 / 9 / 6 / 18**, built entirely by hand — `supabase_migrations` held no rows for it. Baseline captured 2026-09-23. RLS exists but no UPDATE policy has a `WITH CHECK`, and `update_wallet_balance` was executable by `anon` |
| Next.js 15 app scaffolded | ✅ Done | Static export, Tailwind, Shadcn/ui |
| Supabase client (gocash schema) + .env.local | ✅ Done | `createClient<Database, "gocash">` |

#### Auth & Onboarding
| Task | Status | Notes |
|---|---|---|
| Login screen (email + magic link) | ✅ Done | `src/app/login/page.tsx` — passwordless, `signInWithOtp` |
| `useAuthGuard` hook | ✅ Done | `src/hooks/useAuthGuard.ts` — checks session + operator record; redirects to `/login` or `/onboarding` |
| Onboarding flow (set opening wallet balances) | ✅ Done | `src/app/onboarding/page.tsx` — 2-step; creates operator + 3 wallets + 6 default transaction rules |

#### AI Pipeline (Edge Functions)
| Task | Status | Notes |
|---|---|---|
| `_shared/transaction-processing.ts` — business logic | ⚠️ Superseded | Existed in **two diverged copies**. The deployed one had `resolveRule()` and Maya; the `src/lib` mirror had neither, and Cash In/Cash Out keywords were swapped between them. Replaced by `supabase/functions/_core/` |
| `_shared/cors.ts` — CORS helpers | ⚠️ Not deployed | Live `main/_shared/cors.ts` hardcodes `Access-Control-Allow-Origin: "*"`. The repo's origin allowlist was never deployed |
| `process-transaction` Edge Function | ⚠️ Wrong behaviour | **Writes `status: "confirmed"` and moves balances in the same request.** There is no draft and no gate |
| `confirm-transaction` Edge Function | ⚠️ Became an edit endpoint | Rejects anything not already `confirmed`/`edited`. The repo copy also calls an RPC signature that no longer exists (PGRST202) |

#### Core Screens
| Task | Status | Notes |
|---|---|---|
| Capture screen | ✅ Done | `src/app/capture/page.tsx` — gallery + camera; calls `process-transaction`; processing overlay |
| Review & Save screen | ✅ Done | `src/app/confirm/[id]/` — server wrapper + client form; real Supabase data; edit mode |
| Dashboard | ✅ Done | `src/app/page.tsx` — live wallet balances, pending badge, today's summary, recent tx |
| Transaction history | ✅ Done | `src/app/transactions/page.tsx` — live data, date-grouped, type filter chips |
| Transaction detail | ✅ Done | `src/app/transactions/[id]/page.tsx` — full read-only detail; redirects pending → confirm |
| Settings (placeholder) | ✅ Done | `src/app/settings/page.tsx` — nav to sub-screens (not yet built) |

#### Wallet & Settings
| Task | Status | Notes |
|---|---|---|
| Wallet management screen | ⚠️ Partly broken | `src/app/settings/wallets/page.tsx` — selects a `wallets.color` column no repo migration creates (live has it). Direct client `UPDATE` on `wallets.balance` leaves **no audit trail at all** in a money-handling app. Becomes a reconciliation form against the ledger |
| Profit settings (transaction rules editor) | ⚠️ Describes Cash In backwards | `src/app/settings/rules/page.tsx` — its plain-language copy states the inverse of what a Cash In is. Becomes **fee-only**; direction stops being editable |
| Platform management | ⚠️ Delete is a no-op | `src/app/settings/platforms/page.tsx` — no DELETE policy existed, so PostgREST returned success with 0 rows affected, the UI reported "removed", and the platform reappeared on refresh. No guard against deleting a wallet holding a non-zero balance |
| Notification settings | ✅ Done | `src/app/settings/notifications/page.tsx` — Telegram toggle + chat ID; push notifications placeholder |

#### Native Shell & Distribution
| Task | Status | Notes |
|---|---|---|
| Capacitor setup (iOS + Android) | ✅ Done | `capacitor.config.ts`, `com.gocash.tracker`, iOS + Android platforms added |
| `@capacitor/camera` integration | ✅ Done | Native camera/gallery on device, browser fallback on web |
| PWA manifest + icons | ✅ Done | `manifest.json`, favicon.svg, 192/512 PNG icons, viewport meta |
| Android share intent | ✅ Done | `@capgo/capacitor-share-target` + intent filter in AndroidManifest + `useShareIntent` hook |
| iOS Share Extension | ⬜ Todo | P2 — separate Xcode target |
| App Store submission (iOS) | ⬜ Todo | |
| Google Play submission (Android) | ⬜ Todo | |

#### Known Technical Debt
| Item | Severity | Notes |
|---|---|---|
| Maya wallet not auto-created on onboarding | Medium | Resolved differently: `wallets` is being dropped; `provision_operator()` creates accounts per selected platform |
| Unknown tx/platform defaults to "Cash In"/"GCash" | **High, not Low** | Not a safe fallback. Silently guessing in a multi-tenant product posts to the wrong account. The fallback is being **dropped** — `Unknown` means the gate asks |
| iOS Share Extension | Low | P2 — separate Xcode target, requires native extension |
| ~~`pnpm test` — 37 tests passing~~ | **Critical, corrected** | The 37 tests imported `src/lib/transaction-processing.ts`, a copy that had diverged from the deployed logic. **Every passing test exercised code that never ran in production**, and they asserted the *inverted* Cash In/Cash Out keyword mapping. Being deleted with the file |
| `shadcn` is a runtime dependency | Medium | A scaffolding CLI; accounts for 61 of 104 `pnpm audit` advisories. Components are already vendored under `src/components/ui`. Move to `devDependencies` |
| `next` 15.5.14 | Medium | Bump to ≥15.5.24. Applicability is limited — `output: 'export'` means no Next server runs in production |
| `datetime-local` timezone round-trip | Medium | `confirm-form.tsx` reads a TIMESTAMPTZ as local time, then re-shifts it on save — 8h off, twice |
| `audit_logs` has no trigger on `wallets` | Medium | Transaction changes are logged; manual balance overrides are not |
| `ai_raw_text` never populated | Low | Column and TODO exist; nothing writes it. Same for the `starting_cash`/`wallet_balance` snapshots |
| `signInWithOtp({ shouldCreateUser: false })` | Low | Nobody can self-register; onboarding is reachable only for hand-created users. Login copy also says "magic link" while the flow verifies a 6-digit OTP |

---

### ⬜ Milestone 2 — Multi-operator Onboarding
**Goal:** Other operators can sign up and use the app independently
**Target Date:** TBD

| Task | Status | Notes |
|---|---|---|
| Tenant-safe architecture | ⬜ | Plan Phase 2. `operator_numbers`, `platform_catalog`, drawer name resolved by `kind`, per-plan rate limits |
| `ai_usage` metering | ⬜ | The OCR call is cost of goods; without per-tenant cost data the tiers cannot be priced. Needed **before** there are tenants |
| Self-service operator signup | ⬜ | **Not "just needs signup UI".** `login/page.tsx:47` sets `shouldCreateUser: false`, and provisioning is an `AFTER INSERT` trigger that cannot be parameterised — it becomes `provision_operator(user_id, name, email, platforms, opening)` |
| Subscription billing | ⬜ | **PayMongo, not Stripe** — PH-local, supports GCash and Maya, which is how e-wallet agents will actually pay. Deferred until someone asks to pay |
| Push notifications (APNs + FCM) | ⬜ | `operator_devices` does not exist |
| Per-operator Telegram notification settings | ⬜ | |

---

### ⬜ Milestone 3 — Analytics & Reporting
**Goal:** Reports, trends, and batch processing for power operators
**Target Date:** TBD

| Task | Status | Notes |
|---|---|---|
| Daily/weekly/monthly profit reports | ⬜ | |
| Trend charts | ⬜ | |
| CSV export | ⬜ | |
| Multi-image batch upload | ⬜ | |

---

## Where We Left Off

**Last session date:** 2026-09-23
**Last completed task:** Audits #5 and #5a, then the first four commits of the ledger
rebuild (see the Milestone 0 table above). Docs correction pass in progress.

**Next task:** Restore the confirmation gate (plan Phase 1.2), then the golden receipt set
(Phase 1.5).

> **Correction:** the previous entry here read *"All High/Medium findings resolved"* after
> Audit #4. **That was false.** Audit #5 found a critical anon-executable RPC hole, a
> double-confirm that applies deltas twice, two diverged copies of the business logic with
> the tests on the dead one, and Cash In defined in opposite directions in four places.
> Audit #5a then found the live CORS had regressed to `*` — the exact finding #4 claimed
> resolved — and that the repo and production had diverged completely. Several Audit #5
> follow-ups were also marked `[x]` in March against a repo that was not what was running.
>
> A "post-fix verification" audit that reads only the repo cannot verify fixes to a
> hand-built production database. #5a exists because #5 made that mistake.

**Open issues / blockers:** see *Open critical items* under Milestone 0. The two that gate
everything else:
- **The gate does not exist**, and four of six transaction types post wrong
- **No verified backup.** 33 consecutive offsite failures, one SSD, no restore ever tested.
  This is a hard gate before any paying customer

---

## Decisions Made

| Decision | Reason | Date |
|---|---|---|
| Next.js + Capacitor over Flutter | Single codebase for web + iOS + Android; React ecosystem | 2026-03-20 |
| Supabase over PlanetScale/Neon | Self-hosted; RLS handles multi-tenancy. *(The "Realtime needed" half of this rationale was never true — it has zero call sites and is being dropped.)* | 2026-03-20 |
| Remove n8n entirely — AI pipeline in Supabase Edge Functions | Self-contained app; no homelab dependency | 2026-03-21 |
| Next.js as static export only | Required for Capacitor bundling; all backend in Edge Functions | 2026-03-21 |
| ~~One Supabase instance, per-app PostgreSQL schemas~~ | **Superseded 2026-09-23** — shared `auth.users` was the isolation gap, and every `SECURITY DEFINER` function on the shared instance was anon-executable | 2026-03-21 |
| ~~Single-tenant first, multi-tenant schema from day one~~ | **Superseded 2026-09-23** — the target is multi-tenant SaaS outright. Only billing is deferred | 2026-03-20 |
| Double-entry ledger; balances derived, never mutated | The multiplier model had no invariant, so nothing detected that 4 of 6 types were destroying money. Postings must sum to zero | 2026-09-23 |
| Cash In = customer hands over cash → drawer UP, platform DOWN | Operator-confirmed. The PRD, TECH_SPEC and two UI files had it inverted | 2026-09-23 |
| One fee formula: `ceil(max(amount × 2%, ₱5))` | The three per-type formulas in the docs, including a ₱5 Telco ladder, were never real | 2026-09-23 |
| Direction is not operator-configurable | Configurable direction *is* what the `delta_*` columns were, and why four types were wrong. Operators configure platforms, rates and labels | 2026-09-23 |
| Restore the confirmation gate | The OCR is the unreliable part, not the ledger. A misread ₱1,850 → ₱1,850,000 has no cheap detector; the gate is the one place a human sees the number before it becomes truth | 2026-09-23 |
| `auto_confirm_below_minor`, default off | Bounded, opt-in concession replacing the unbounded bypass that exists today. Natural paid-tier feature | 2026-09-23 |
| Dedicated 5-service Supabase stack (~485 MiB) | Own `auth.users`; stock stack (~2.3 GiB) is reckless on a box with ~6 GiB free and swap 80% full. PocketBase rejected: no constraint triggers, no exclusion constraints, no RLS | 2026-09-23 |
| Drop Supabase Realtime | Verified zero usage; ~123 MiB for a feature nothing calls | 2026-09-23 |
| Receipts: keep N days, then purge | Customers' mobile numbers held on behalf of other operators — PH Data Privacy Act | 2026-09-23 |
| Billing deferred until someone asks to pay | 2–3 weeks against zero validation (2 operators, 1 transaction). The OCR has no error bar yet — that is the bigger product risk | 2026-09-23 |
| Verified restore is a hard gate before the first paying customer | 33 consecutive offsite backup failures; a single copy on one SSD | 2026-09-23 |
| Share-to-app input method (Android P1, iOS P2) | Natural mobile workflow — screenshot in GCash, share directly | 2026-03-22 |
| No timeout on unconfirmed transactions | Stay in "To Review" indefinitely; dashboard badge prevents misses | 2026-03-22 |
| Plain language UI throughout | Future operators are non-technical | 2026-03-22 |
| Magic link auth (no password) | Operators won't forget passwords; simpler onboarding | 2026-03-22 |
| `createClient<Database, "gocash">` | Explicit schema type param required for correct TypeScript inference on non-public schemas | 2026-03-22 |
