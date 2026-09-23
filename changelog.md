# Changelog

> A running log of changes made to this project over time.
> Maintained by Claude. Update after completing each feature or milestone.

---

## [Unreleased] — Ledger Rebuild (`feature/ledger-rebuild`)

Driven by `AUDITS.md` #5 and #5a and the approved plan at
`~/.claude/plans/i-think-the-whole-async-sparrow.md`.

**Why:** the money model had no invariant, and **4 of its 6 transaction types were posting
wrong in production** — on a ₱100 transaction, Telco Load came to −95, Bills Payment −95,
Bank Transfer −100, and Profit Remittance recorded a cash-*in*. Balances were mutated in
place and could not be recomputed, so the damage was not repairable either. Separately, the
confirmation gate — the product's stated core premise — **did not exist**, and six
`SECURITY DEFINER` functions were callable with the public anon key and no session.

### Security (`eb7f86f`)
- `20260923000001_revoke_public_execute.sql` — `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` on all six `SECURITY DEFINER` functions. They carried the PostgreSQL default grant to `PUBLIC`, took `p_operator_id` as a caller parameter, and referenced `auth.uid()` nowhere. Verified exploitable end-to-end with the public anon key
- `20260923000002_default_privileges.sql` — stops the next function added from inheriting the same grant

### Added
- `supabase/migrations/20260923000000_baseline_gocash.sql` (`eb7f86f`) — the live schema captured as a squashed baseline. Production had been built **entirely by hand**: 7 tables, 9 functions, 6 triggers, 18 indexes, against the repo's 5/2/0/0. The repo is the source of truth again
- `supabase/functions/_core/` (`c16164c`) — `money.ts`, `postings.ts`, `fees.ts`, `types.ts` + tests. Integer centavos, the six posting shapes, fee resolution. Deno-compatible with zero runtime deps; imported directly by the Edge Functions and by Next.js via a tsconfig path alias
- `supabase/migrations/20260924000001_ledger_tables.sql` (`acef102`) — `accounts`, `ledger_entries`, `postings`, the `account_balances` view (`security_invoker = true`), append-only triggers, and a `DEFERRABLE INITIALLY DEFERRED` zero-sum trigger. Balances are now **derived**, never mutated
- `supabase/migrations/20260924000002_fee_rules.sql` (`acef102`) — effective-dated `fee_rules` (`rate_bps`, `minimum_minor`, `rounding`, `effective_from`/`to`) with a GiST exclusion constraint on overlapping periods. Needed because a reversible-and-repostable entry would otherwise have its history silently rewritten by a fee change
- `~/homelab/gocash/docker-compose.yml` — dedicated 5-service Supabase stack (`db`, `rest`, `auth`, `storage`, `functions`, ~485 MiB). Own `auth.users`, own JWT secret and keys, routed by the existing Traefik. No Kong, analytics, studio, pooler, imgproxy or realtime

### Fixed
- `962f1cd` — five holes found in review of the ledger work

### Changed — decisions recorded
- **Cash In direction corrected.** The customer hands over **cash** and receives e-money: drawer **UP** by amount + fee, platform wallet **DOWN** by amount, revenue up by the fee. `PRD.md` FR-21, `TECH_SPEC.md` §4.2, `settings/rules/page.tsx` and `onboarding/page.tsx` all stated the inverse — so any operator onboarded with then-current repo code got backwards rules
- **One fee formula for all six types:** `ceil(max(amount × 2%, ₱5))`. The three per-type formulas in the docs, including a ₱5 Telco Load bracket ladder, were fiction. *(Nuance: `_core/fees.ts` applies the ceiling to Cash In and Cash Out only; the other four keep centavo precision — a deliberate deviation preserving live behaviour.)*
- **Direction is no longer operator-configurable.** Configurable direction is exactly what the `delta_*` multiplier columns were. Profit Settings becomes fee-only
- **Multi-tenant SaaS is the target**, with billing deferred until someone asks to pay
- **Hosting:** dedicated GoCash stack, not the shared instance. The shared-schema strategy in `architecture.md` and `CLAUDE.md` is superseded

### Deprecated / to be removed
- `gocash.wallets`, `transaction_rules` and the three `delta_*` columns
- `update_wallet_balance`, `confirm_transaction_atomic` (which had grown to 18 arguments as a hand-rolled reversal engine), both `delete_transaction_atomic` overloads, `initialize_operator_defaults`
- `src/lib/transaction-processing.ts` **and its 37 tests** — a copy-paste that diverged from the deployed logic. Every passing test exercised code that never ran in production, and they asserted the *inverted* Cash In/Cash Out keyword mapping
- Supabase **Realtime** — documented as a core dependency across six files and never used (zero `.channel(`/`.subscribe()` call sites)

### Documentation (this pass)
- Status banners added to `PRD.md`, `TECH_SPEC.md`, `architecture.md` pointing at AUDITS #5/#5a and the plan
- Present-tense claims about the confirmation gate re-marked as target state in `README.md`, `CLAUDE.md`, `architecture.md`, `PRD.md`
- `project-status.md` "feature-complete" and "All High/Medium findings resolved" corrected
- Status value normalised to `awaiting_confirm` (the live CHECK) throughout
- Removed a dead n8n webhook ID, an operator's personal phone numbers (`project-spec.md`, `CLAUDE.md`, `PRD.md`) and a hardcoded operator account number in shipped classification logic (`TECH_SPEC.md` §6.2)
- Corrected a `tx_rules` table name that never existed and an `operator_devices` table that never existed
- Added **FR-27 receipt retention** — PH Data Privacy Act; no doc had ever mentioned retention or deletion

### Still open (not addressed by these commits)
- **The confirmation gate is not yet restored** — `_process_transaction.ts` still writes `status: "confirmed"` and moves balances in one request
- No RLS `WITH CHECK` on any UPDATE policy
- Live CORS is still `*` — a regression against Audit #4's "CORS restricted" claim
- Golden receipt set not started; the OCR still has no accuracy measurement
- Offsite backup has never succeeded (33 consecutive nights); no restore ever tested

### To Do
- iOS Share Extension (P2 — separate Xcode target)
- App Store / Google Play submission

---

## [v0.4.0] — 2026-03-22 — UI Polish + Settings Screens

### Added
- `src/app/settings/wallets/page.tsx` — Wallet Management: gradient card headers per wallet, inline balance editing with peso-prefixed input, success indicator, manual adjustment only
- `src/app/settings/rules/page.tsx` — Profit Settings: plain-language descriptions per transaction type, inline rate (%) / minimum (₱) editing, active/inactive toggle, formula explanation
- `src/app/settings/platforms/page.tsx` — Platform Management: list all platforms, add custom platforms (creates wallet + seeds transaction rules), delete custom platforms; built-in platforms (GCash, MariBank, Cash) protected
- `src/app/settings/notifications/page.tsx` — Notification Settings: Telegram toggle + chat ID input, push notifications placeholder (coming soon)
- `capacitor.config.ts` — Capacitor config: `com.gocash.tracker` app ID, `out/` webDir, Camera plugin
- `ios/` + `android/` native platforms — scaffolded via `cap add`, Camera + Filesystem plugins auto-detected
- `public/manifest.json` — PWA web app manifest (standalone, portrait, emerald theme)
- `public/favicon.svg`, `public/icon-192.png`, `public/icon-512.png` — app icons
- `src/app/transactions/[id]/transaction-detail.tsx` — extracted client component from page.tsx for static export compatibility

### Changed
- **Login** — glass card form, radial emerald glow, gradient logo with status dot
- **Dashboard** — wallet cards upgraded to 280px snap-scroll with gradient backgrounds, decorative blurs, drag-to-scroll, progress dots
- **Capture** — square hero card with camera icon, AI-powered badge, single inputRef pattern for camera/gallery
- **Confirm/Edit** — compact header with inline Fix/Done toggle, amber tint in edit mode, AI badge strip
- **Transaction History** — emerald active chip, pulsing amber Review badge, ChevronRight on confirmed items, expanded filter list

### Fixed
- `Relationships: []` added to all 5 tables in `src/types/database.ts` — required by Supabase JS v2.99.3's `GenericSchema` constraint
- `operatorId` null narrowing across async closures — `const opId = operatorId` pattern applied to 4 files
- `Select` `onValueChange` null coalescing in confirm-form (`v ?? ""`)
- TypeScript builds with zero errors

### Changed
- **Capture page** — now uses `@capacitor/camera` on native platforms (base64 result), falls back to browser file input on web
- **Layout** — added favicon, apple-touch-icon, viewport-fit=cover, theme-color meta
- **Transaction detail** — split into server wrapper (`page.tsx` with `generateStaticParams`) + client component (`transaction-detail.tsx`) for static export
- **package.json** — added `cap:sync`, `cap:ios`, `cap:android` convenience scripts

### Added (Android Share Intent)
- `@capgo/capacitor-share-target` plugin — receives images from Android share sheet
- `android/app/src/main/AndroidManifest.xml` — `ACTION_SEND` intent filter for `image/*`
- `src/hooks/useShareIntent.ts` — listens for share events, stores in sessionStorage, navigates to `/capture`
- Capture page auto-processes shared images on mount via sessionStorage handoff

### Added (Unit Tests)
- `src/lib/__tests__/transaction-processing.test.ts` — 37 tests covering all 5 business logic functions: detectPlatform, detectType, calculateProfit, extractAccountNumber, computeWalletDeltas

---

## [v0.3.0] — 2026-03-22 — Bug Fixes & TypeScript Fixes

### Fixed
- **TypeScript build errors**: `createClient<Database>` → `createClient<Database, "gocash">` — without explicit schema type param, all Supabase queries resolved to `never` on non-public schemas
- **Database Insert types**: Rewrote `src/types/database.ts` Insert types to exclude auto-generated columns (`id`, `created_at`, `updated_at`, `year`, `month`, `day`) and mark nullable/defaulted fields as optional
- **Select `onValueChange` type mismatch**: Wrapped `setPlatform`/`setTxType` dispatch calls as `(v) => setPlatform(v)` to satisfy strict function type checking
- **`confirm-transaction` wallet update bug**: Platform wallet was being `.update({ balance: adminClient.rpc(...) })` — passing an RPC builder object instead of a numeric value. Replaced with direct `update_wallet_balance` RPC call matching the cash wallet pattern
- **Cash wallet failure silently ignored**: Was logging the error but continuing to confirm the transaction. Now returns 500 and blocks confirmation, preventing confirmed transactions with inconsistent wallet state
- **`Views` / `Functions` missing from Database type**: Added `Views: Record<string, never>` and `Functions: Record<string, never>` to satisfy Supabase's `GenericSchema` interface

### Added
- `src/app/transactions/[id]/page.tsx` — transaction detail screen (read-only); redirects pending transactions to `/confirm/[id]` automatically
- `src/app/settings/page.tsx` — settings hub with nav links to sub-screens (placeholders for wallet/rules/platforms/notifications)

---

## [v0.2.0] — 2026-03-22 — Core App Screens

### Added
- `src/app/login/page.tsx` — magic link sign-in (passwordless); auto-redirects if session exists; "check your email" confirmation state
- `src/hooks/useAuthGuard.ts` — shared hook: checks session → if none, redirects to `/login`; checks operator record → if none, redirects to `/onboarding`; returns `{ session, operatorId, loading }`
- `src/app/onboarding/page.tsx` — 2-step first-time setup: (1) name + phone, (2) opening wallet balances; creates `operators` row + 3 wallets (GCash, MariBank, Cash) + 6 default transaction rules
- `src/app/capture/page.tsx` — screenshot capture screen; gallery picker + camera (`capture="environment"`); drag & drop on desktop; calls `process-transaction` Edge Function; full-screen processing overlay; redirects to `/confirm/[id]` on success
- `src/app/confirm/[id]/page.tsx` — static server wrapper with `generateStaticParams`
- `src/app/confirm/[id]/confirm-form.tsx` — review & save client component; fetches real transaction from Supabase; read-only by default, "Fix Details" toggles edit mode; only sends changed fields to `confirm-transaction`; `/confirm/preview` uses mock data for static export

### Changed
- `src/app/page.tsx` — Dashboard wired to real Supabase data: live wallet balances, pending count, today's summary (count/total/earnings), last 5 transactions; auth guard added
- `src/app/transactions/page.tsx` — Transaction History wired to real Supabase data: live transactions, date-grouped, type filter chips; pending items link to `/confirm/[id]`

---

## [v0.1.1] — 2026-03-22 — AI Pipeline & Edge Functions

### Added
- `supabase/functions/_shared/cors.ts` — CORS headers + `handleCors` + `jsonResponse` helpers shared across Edge Functions
- `supabase/functions/_shared/transaction-processing.ts` — pure business logic: `detectPlatform`, `detectType`, `calculateProfit`, `extractAccountNumber`, `computeWalletDeltas`; operator blacklist numbers hardcoded
- `supabase/functions/process-transaction/index.ts` — Phase 1 Edge Function: auth → resolve operator → GPT-4o vision OCR (single-pass, JSON mode) → business logic fallbacks → profit calc → insert `awaiting_confirmation` transaction
- `supabase/functions/confirm-transaction/index.ts` — Phase 2 Edge Function: auth → verify ownership → merge edits → re-calc profit if changed → `update_wallet_balance` RPC (platform + cash) → confirm transaction
- `src/lib/transaction-processing.ts` — Node.js mirror of `_shared/transaction-processing.ts` for unit tests
- Supabase migration: added `user_id` column to `gocash.operators`, `ai_raw_text` column to `gocash.transactions`, `gocash.update_wallet_balance` atomic RPC function, RLS policies for operators

---

## [v0.1.0] — 2026-03-21 — Project Setup

### Added
- `PRD.md` — full product requirements document (v4.0) as standalone app spec
- `TECH_SPEC.md` — technical specification (v3.0)
- `CLAUDE.md` — project memory with tech stack, domain knowledge, constraints
- `architecture.md` — system architecture (n8n removed; Edge Functions as AI pipeline)
- `project-status.md` — milestone tracker
- `changelog.md` — this file
- Next.js 15 app scaffold (static export, Tailwind, Shadcn/ui)
- Supabase `gocash` schema: operators, transactions, wallets, transaction_rules, audit_logs + RLS
- Template scaffolding: `.ai/prompts/`, `docs/workflow.md`, `HUMAN_GUIDE.md`
