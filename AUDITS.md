# Audits Log

This file is the running audit history for this repository.

Rule: every time we run a codebase audit, append a new entry here.

---

## Entry Template

Copy this block for future audits:

```md
## [YYYY-MM-DD] Audit Name

### Scope
- ...

### Validation Gates
- `pnpm run typecheck`: PASS/FAIL
- `pnpm run lint`: PASS/FAIL
- `pnpm run test`: PASS/FAIL
- `pnpm run build`: PASS/FAIL
- `pnpm audit --prod`: PASS/FAIL/NOT RUN (+ reason)

### Key Findings
1. ...
2. ...

### Follow-Ups
- [ ] ...
- [ ] ...
```

---

## 2026-03-22 Audit #1 (Full Codebase + Markdown Evaluation)

### Scope
- Full scan of `src/`, `supabase/functions/`, and all project Markdown docs.
- Build/test/type/lint validation and spec-vs-code consistency checks.

### Validation Gates
- `pnpm run typecheck`: FAIL (multiple TS errors in auth/onboarding/dashboard/confirm form)
- `pnpm run lint`: FAIL (`next lint` interactive ESLint setup prompt)
- `pnpm run test`: FAIL (no tests found at that time)
- `pnpm run build`: FAIL (blocked by TypeScript errors)
- `pnpm audit --prod`: Not run in this pass

### Key Findings
1. TypeScript build blockers across core screens and Supabase types.
2. Static export + dynamic ID routes risk (`/confirm/[id]` not generated for real IDs).
3. Wallet update consistency risks in `confirm-transaction`.
4. Significant docs drift versus implementation.

### Follow-Ups
- [ ] Keep Supabase generated types aligned with schema changes.
- [ ] Ensure lint is non-interactive and CI-ready.
- [ ] Keep architecture/spec docs synchronized after major feature work.

---

## 2026-03-22 Audit #2 (In-Depth Re-Evaluation)

### Scope
- Deep re-audit after additional feature files appeared (`settings/*`, `transactions/[id]`, tests, Capacitor assets).
- Re-checked runtime correctness, security posture, and docs/process consistency.

### Validation Gates
- `pnpm run typecheck`: PASS
- `pnpm run lint`: FAIL (`next lint` still interactive; no ESLint config finalized)
- `pnpm run test`: PASS (37/37 tests in `src/lib/__tests__/transaction-processing.test.ts`)
- `pnpm run build`: PASS (static export completed; 15 pages)
- `pnpm audit --prod`: FAIL TO RUN (`ENOTFOUND registry.npmjs.org` in this environment)

### Key Findings
1. Status mismatch bug: `awaiting_confirm` (Edge Function write) vs `awaiting_confirmation` (UI/types) breaks pending/review flow.
2. Rule matching logic can prioritize `"all"` over platform-specific rules (custom platform economics risk).
3. Confirmation flow is still non-atomic across wallet updates + transaction finalization.
4. Sensitive debug logging present in Edge Functions.
5. Docs/process files still contain stale paths/claims and outdated architecture references.

### Follow-Ups
- [ ] Normalize transaction status values across DB/types/Edge/UI.
- [ ] Update rule resolution to prefer exact platform before `"all"`.
- [ ] Move confirm flow to a single transactional DB function.
- [ ] Remove debug logs with payload contents from Edge Functions.
- [ ] Fix lint setup (`eslint.config.*`) so `pnpm run lint` is non-interactive.
- [ ] Reconcile `README.md`, `TECH_SPEC.md`, workflow prompts, and verification docs with current implementation.

---

## 2026-03-22 Audit #3 (Full Re-Audit + Comprehensive Security Audit)

### Scope
- Full re-audit of application code (`src/`, `supabase/functions/`) and all Markdown docs.
- Static-export and native asset consistency checks (`out/`, `ios/`, `android/` artifacts).
- Dependency vulnerability audit and focused security review (auth, data integrity, input handling, and exposure risks).

### Validation Gates
- `pnpm run typecheck`: PASS
- `pnpm run lint`: FAIL (`next lint` interactive setup prompt; no finalized ESLint config)
- `pnpm run test`: PASS (37/37 tests)
- `pnpm run build`: PASS (static export complete; 15 routes)
- `pnpm audit --prod`: PASS (no known vulnerabilities; required network access)

### Key Findings (Severity-Ordered)
1. **High — Pending review flow has broken route contracts.**  
   Confirm now resolves transaction IDs from `/confirm?id=...`, but other screens still navigate to `/confirm/:id`, and static export only generates `/confirm` (plus stale native `confirm/preview` assets).
2. **High — Status contract mismatch persists in Phase 1.**  
   `process-transaction` inserts `awaiting_confirm` but returns `awaiting_confirmation` in response payload.
3. **High — Confirmation write path is not atomic.**  
   Platform wallet RPC, cash wallet RPC, and transaction confirmation are separate operations; partial failure can leave financial state inconsistent.
4. **High — Server-side validation gaps in `confirm-transaction`.**  
   `edits.amount` and `edits.net_profit` are accepted without strict numeric/bounds validation, enabling invalid wallet mutations.
5. **High — No request-size/rate controls on AI processing endpoint.**  
   `process-transaction` accepts arbitrary base64 payloads and can be abused for cost amplification/DoS.
6. **Medium — Potential sensitive-data logging in Phase 1 parse failures.**  
   Parse error path logs full model output content, which may include sensitive OCR text.
7. **Medium — CORS remains wildcard (`*`) in shared Edge Function headers.**
8. **Medium — Rule precedence bug still unresolved.**  
   `"all"` rules can match before platform-specific rules in both shared business-logic modules.
9. **Medium — Notification settings update can clobber unrelated operator settings keys.**
10. **Low/Operational — Native bundle assets appear stale relative to current web export.**  
    Native artifacts still include `/confirm/preview` route shape, increasing environment drift risk.
11. **Medium — Documentation drift is now significant across key project docs.**  
    Multiple docs still describe n8n-era or outdated flows/paths/versions and inaccurate verification states.
12. **Medium — SQL migrations/policy definitions are not present in repo.**  
    RLS/security claims cannot be independently verified from source-controlled migration files.

### Security Audit Notes
- Secrets scan: no server-only secret values found in tracked source files; `.env.local` remains untracked.
- Public Supabase anon key appears in built client/native JS bundles (expected for client SDK usage).
- Dependency CVE scan (`pnpm audit --prod`): no known production vulnerabilities reported.

### Follow-Ups
- [x] Unify confirm routing to a single contract and update all links/navigation paths accordingly.
- [x] Normalize `awaiting_confirm` vs `awaiting_confirmation` usage across Edge/API/UI/docs.
- [x] Move wallet + transaction confirmation updates into one transactional DB function.
- [x] Add strict server-side schema validation (types/ranges) for all editable confirmation fields.
- [x] Enforce image payload size limits, MIME allowlist, and rate limits on `process-transaction`.
- [x] Remove or redact high-sensitivity payload logging in Edge Functions.
- [x] Restrict CORS origins for production environments.
- [x] Fix rule resolution to prefer exact platform match over `"all"` fallback.
- [x] Merge notification settings updates instead of replacing the full `settings` object.
- [ ] Re-sync native assets (`cap sync`) and verify route parity with current static export.
- [ ] Reconcile stale docs (`README.md`, `architecture.md`, `project-spec.md`, `docs/stack-decision-record.md`, workflow command docs, and verification records).
- [x] Add source-controlled Supabase SQL migrations (schema + RLS + RPCs) for auditable security posture.

---

## 2026-03-22 Audit #4 (Post-Fix Verification)

### Scope
- Verification pass after resolving all Audit #3 High and Medium findings.
- Re-checked runtime, routing, security posture, and platform support.

### Validation Gates
- `pnpm run typecheck`: PASS
- `pnpm run lint`: FAIL (interactive ESLint setup — low priority, no config file)
- `pnpm run test`: PASS (37/37)
- `pnpm run build`: PASS (static export, 15 routes)
- `pnpm audit --prod`: PASS (no known vulnerabilities)

### Key Findings
1. All Audit #3 High findings resolved: route contracts unified, status strings normalized, atomic confirmation deployed, edge function validation in place, rate limiting active.
2. All Audit #3 Medium findings resolved: CORS restricted, rule precedence fixed, notification settings merge pattern in place, debug logging redacted, SQL migrations in repo.
3. Platform "Maya" added to types, detectPlatform, and confirm form — but no Maya wallet auto-creation in onboarding yet.
4. App deployed to gocash.zether.net and tested on real device (PWA). Transaction detail view (query-param routing) confirmed working.

### Follow-Ups
- [ ] Add Maya wallet auto-creation in onboarding flow.
- [ ] Wallet color customization feature.
- [ ] Run `npx cap sync` before next iOS/Android native build.
- [ ] Finalize ESLint config so `pnpm run lint` is non-interactive.

---

## 2026-09-23 Audit #5 (Full Review — Security, Data Integrity, Dead Paths)

### Scope
- Full read of `src/` (15 routes, hooks, lib), `supabase/functions/`, `supabase/migrations/`.
- Validation gates re-run; dependency audit; spec-vs-code consistency.

### Validation Gates
- `pnpm run typecheck`: PASS
- `pnpm run lint`: FAIL (still no ESLint config — interactive prompt; open since Audit #1)
- `pnpm run test`: PASS (37/37) — but see Finding 4: tests cover the wrong copy of the logic
- `pnpm run build`: PASS (static export, 15 routes)
- `pnpm audit --prod`: FAIL (2 critical / 41 high) — see Finding 12 for applicability

### Key Findings

**Critical**
1. **`confirm_transaction_atomic` and `update_wallet_balance` are `SECURITY DEFINER` and `GRANT EXECUTE ... TO authenticated`.** Both take `p_operator_id` and the wallet deltas as caller-supplied parameters and never check `auth.uid()`. Any signed-in user can `supabase.rpc(...)` directly and set arbitrary wallet deltas — bypassing the rules engine and the Phase-2 confirmation gate entirely — or target another operator's `operator_id` if one ever leaks. The Edge Function already uses the service-role key, so the grant buys nothing.
   *Fix:* `REVOKE EXECUTE ... FROM authenticated, anon` on both, and/or add an `auth.uid()` ownership check inside the function body.

2. **`process-transaction` cannot load.** `supabase/functions/process-transaction/index.ts:16` imports `corsHeaders` from `_shared/cors.ts`, which does not export it (only `handleCors` and `jsonResponse`). Deno fails module linking with `SyntaxError: The requested module does not provide an export named 'corsHeaders'`. The symbol is otherwise unused — deleting it from the import fixes it.

**High**
3. **Double-confirm applies wallet deltas twice.** `confirm-transaction/index.ts:111` checks `tx.status === "confirmed"` in the Edge Function, but `confirm_transaction_atomic` has no status guard in its `UPDATE ... WHERE id = ... AND operator_id = ...`. Two concurrent confirms (double-tap, retry on slow network) both pass the check and both apply deltas.
   *Fix:* add `AND status <> 'confirmed'` to the transaction `UPDATE` inside the function so the second call raises.

4. **The two copies of the business logic have diverged, and the tests cover the dead one.** `src/lib/transaction-processing.ts` and `supabase/functions/_shared/transaction-processing.ts` are near-duplicates. The `_shared` copy (the one actually deployed) has `resolveRule()` — exact-platform match wins over `"all"` — plus Maya detection. The `src/lib` copy still uses the old first-match-wins `find()` and has no Maya. `src/lib/__tests__/transaction-processing.test.ts` imports `../transaction-processing`, i.e. the client copy. **Every one of the 37 passing tests exercises code that never runs in production.**
   *Fix:* delete one copy; have the Edge Functions and the tests import a single source.

5. **"Cash In" is defined in opposite directions in two places.** The OCR prompt (`process-transaction/index.ts:74`) says Cash In = *"customer gave the operator CASH and received e-wallet credit (cash enters operator's drawer)"*, so the platform wallet should go **down** and cash **up**. The seeded rule (`src/app/onboarding/page.tsx:245`) does `delta_platform_mult: 1, delta_cash_amount_mult: -1` — platform **up**, cash **down**. Cash Out is the mirror image of the same conflict. The docstring in `transaction-processing.ts:172` contradicts itself in one line. One of these is wrong and every Cash In/Cash Out moves both balances backwards.

6. **Deleting a platform silently does nothing.** `settings/platforms/page.tsx:139` deletes from `wallets` and `transaction_rules`, but RLS is enabled with only SELECT/INSERT/UPDATE policies — no DELETE policy exists on any table. PostgREST returns success with 0 rows affected, so `delErr` is null, the UI removes the row optimistically and reports "removed", and the platform reappears on refresh. There is also no guard against deleting a wallet that holds a non-zero balance or has confirmed transactions.

7. **Settings → Wallets is broken: the `color` column does not exist.** `settings/wallets/page.tsx:86` selects `color` and line 153 updates it, but no migration adds `wallets.color` (it is still an open follow-up from Audit #4). The select errors, `data` is null, and the page renders an empty wallet list. The `as unknown as Wallet[]` and `as any` casts hide this from the type checker. The "revert on failure" at line 155 is also a no-op — it maps `w.color` back to itself after the optimistic update already overwrote it.

8. **Custom platforms can never record a transaction.** `settings/platforms/page.tsx` lets an operator add a wallet with any name, but `transactions.platform` has `CHECK (platform IN ('GCash','MariBank','Maya','Unknown'))`. Any transaction on a custom platform fails the constraint on insert.

9. **"Edit Transaction" is dead on every confirmed transaction.** `transactions/[id]/transaction-detail.tsx:172` links to `/confirm?id=...`; `confirm-transaction` returns 409 `"Transaction is already confirmed"` for exactly those rows. There is no edit-after-confirm path at all (no reversal/adjustment flow either).

**Medium**
10. **Duplicate screenshots are not deduplicated.** `process-transaction/index.ts:256` handles Postgres error `23505` on `reference_number` — but no unique constraint on `(operator_id, reference_number)` exists in any migration. The recovery branch is unreachable and re-uploading the same receipt creates a second transaction that double-counts on confirm.
11. **`transaction_date` shifts by the UTC offset.** `confirm-form.tsx:134` feeds a `TIMESTAMPTZ` string sliced to `YYYY-MM-DDTHH:mm` into a `datetime-local` input, which reads it as *local* time — so the field displays UTC values as if they were PHT (8h off). Editing it then runs `new Date(txDate).toISOString()` (line 157), shifting it a second time on save.
12. **`pnpm audit --prod`: 104 advisories (2 critical, 41 high).** Applicability is limited: the app is `output: 'export'`, so no Next.js server runs in production and the RCE/SSRF/middleware-bypass advisories affect only `next dev`/`next start` locally. Still worth bumping `next` 15.5.14 → ≥15.5.24. Separately, **`shadcn` is listed as a runtime `dependency`** (61 of the 104 advisories) — it is a scaffolding CLI and the components are already vendored under `src/components/ui`; move it to `devDependencies` or drop it.
13. **Clearing a field silently keeps the old value.** `confirm-transaction/index.ts:235-237` uses `edits.account_number ?? tx.account_number`; the client sends `null` to clear (`confirm-form.tsx:154`), so `??` falls back to the previous value. Applies to `account_number`, `reference_number` and `transaction_date`.
14. **`audit_logs` is never written.** The table, its RLS policy and its generated types exist; nothing in `src/` or `supabase/functions/` inserts a row. Manual balance overrides in Settings → Wallets — direct client `UPDATE` on `wallets.balance` — therefore leave no trace at all in a money-handling app.
15. **No RLS `WITH CHECK` on any UPDATE policy.** `operators_update_own`, `wallets_update_own`, `transactions_update_own` and `rules_update_own` specify `USING` only. A user can update a row they own and set `operator_id` (or `operators.user_id`) to another tenant's id, writing rows into someone else's ledger. Also lets a user set their own `subscription_tier`.
16. **No indexes anywhere.** Every query filters on `operator_id` plus `status`/`created_at`; the schema creates no index beyond the primary keys and the two unique constraints.
17. **Migration 003 and 004 define `confirm_transaction_atomic` identically.** 004 is a byte-for-byte redundant `CREATE OR REPLACE`.
18. **No client-side numeric validation on the confirm form.** Clearing Amount or Earnings sends `NaN` → serialized as `null` → a 400 from the Edge Function reading "Invalid amount". Neither field sets `type="number"`/`inputMode="decimal"`, so mobile users get the alphabetic keyboard on a mobile-first app.

**Low**
19. `signInWithOtp({ shouldCreateUser: false })` (`login/page.tsx:47`) means no one can self-register; the entire onboarding flow is reachable only for users created by hand in Supabase. Login copy ("Send sign-in link", "one-tap link") also describes a magic link while the flow verifies a 6-digit OTP.
20. `transactions/[id]/page.tsx` is unreachable — `generateStaticParams` emits only `/transactions/preview` and everything links to `/transactions?id=`. Dead route.
21. `compressImage` rejections in `capture/page.tsx:99` are never caught (`handleFileChange` doesn't await or catch), so an undecodable image does nothing at all with no error shown.
22. `ai_raw_text` is never populated despite the column existing and the insert carrying a TODO comment about it; `starting_cash` / `wallet_balance` snapshots are likewise never written.
23. The rate-limit check (`process-transaction/index.ts:146`) skips silently when the count query errors (`count` is null).
24. `Capacitor.isNativePlatform()` is evaluated at module scope (`capture/page.tsx:22`), so it is baked during prerender.
25. Status `'edited'` is in the CHECK constraint and queried by the dashboard, but nothing ever sets it (confirm always writes `'confirmed'` and tracks edits via `was_edited`).
26. The bottom nav is copy-pasted into four pages; `TYPE_CONFIG`, `maskNumber` and `formatTime` are duplicated across `page.tsx`, `transactions/page.tsx` and `transaction-detail.tsx`.
27. `readOnly={false}` on every `Input` in the confirm form is a no-op.

### Follow-Ups
- [ ] **Revoke `EXECUTE` on both `SECURITY DEFINER` functions from `authenticated`/`anon`, or add an `auth.uid()` ownership check inside them.**
- [ ] **Remove the unused `corsHeaders` import from `process-transaction`, then redeploy and smoke-test the capture flow.**
- [ ] Add `AND status <> 'confirmed'` to the transaction UPDATE in `confirm_transaction_atomic`.
- [ ] Collapse the two `transaction-processing.ts` copies into one and point the tests at the deployed copy.
- [ ] Settle the Cash In / Cash Out direction across the OCR prompt, the seeded rules and the docstring; back it with a test per transaction type asserting the sign of both deltas.
- [ ] Add DELETE policies (or replace hard delete with an `is_active` flag) and stop reporting success on 0 rows affected.
- [ ] Migration for `wallets.color`, or revert the Settings → Wallets color feature.
- [ ] Replace the `transactions.platform` CHECK with a FK to the operator's wallets, or drop custom-platform creation.
- [ ] Decide the edit-after-confirm story (reversal entry vs. allowing re-confirm) and fix or hide the Edit button.
- [ ] Unique constraint on `(operator_id, reference_number)` so the existing dedupe branch works.
- [ ] Fix the `datetime-local` timezone round-trip.
- [ ] Add `WITH CHECK` to every UPDATE policy.
- [ ] Indexes on `transactions(operator_id, created_at DESC)`, `transactions(operator_id, status)`, `transaction_rules(operator_id, is_active)`.
- [ ] Write `audit_logs` rows for confirmations and manual balance overrides.
- [ ] Move `shadcn` to `devDependencies`; bump `next` to ≥15.5.24.
- [ ] Finally add an ESLint config so `pnpm run lint` is non-interactive (open since Audit #1).

---

## 2026-09-23 Audit #5a (Live Homelab Verification — Corrections to Audit #5)

### Scope
- Verified every Audit #5 finding against the running instance: `supabase-db`, `supabase-rest`,
  and the edge runtime at `/home/zether/homelab/supabase/volumes/functions/`.
- Audit #5 read the repo only. **The repo is not the source of truth** — production has drifted
  well ahead of `gocash-app/supabase/`. Several Audit #5 findings are repo-only and are corrected below.

### Systemic finding: repo ↔ production drift
| | Repo (`gocash-app/supabase/`) | Live (homelab) |
|---|---|---|
| Tables | 5 | **7** (`+operator_platforms`, `+receipt_deletion_queue`) |
| Functions | 2 | **9** (`+delete_platform_atomic`, `+delete_transaction_atomic` ×2 overloads, `+upsert_operator`, `+initialize_operator_defaults`, `+log_transaction_changes`, `+update_updated_at`) |
| Triggers | 0 | **6** (4× `updated_at`, `audit_transactions`, `init_operator_defaults`) |
| Indexes on `gocash` | 0 | **18** |
| `confirm_transaction_atomic` args | 16 | **18 — different signature** |
| Edge functions | 2 | 5, served only from `main/` |

The live schema was built by hand, not by the migrations in the repo. Re-running
`supabase/migrations/` against a fresh instance reproduces **none** of the above.

- **The repo's `confirm-transaction` cannot work against the live database.** It calls the RPC with
  `p_platform_wallet` / `p_platform_delta`; the live function takes
  `p_previous_platform_wallet` / `p_previous_platform_delta` / `p_next_platform_wallet` /
  `p_next_platform_delta` (it gained reversal support for edit-after-confirm). PostgREST resolves
  RPCs by argument name, so the repo's call returns PGRST202.
- **Only `main/` is served.** `docker inspect supabase-edge-functions` → `start --main-service
  /home/deno/functions/main`. The `confirm-transaction/`, `process-transaction/`,
  `delete-transaction/` and `cleanup-receipts/` directories in the functions volume are never
  executed — stale copies alongside the live ones.

### Corrections — Audit #5 findings that do NOT apply to production
- **#2 (critical, `corsHeaders` import crash): repo-only.** Live `main/_shared/cors.ts` is a
  different file and imports cleanly. Production is unaffected; the broken file is the stale repo copy.
- **#7 (`wallets.color` missing): repo-only.** Live `wallets` has both `color` and `is_active`.
  The migrations are missing them, not the database.
- **#8 (custom platforms blocked by CHECK): repo-only.** `transactions_platform_check` has been
  dropped live and replaced by the `operator_platforms` table.
- **#10 (no dedupe constraint): repo-only.** Live has `unique_reference_per_operator` on
  `(operator_id, reference_number)`, so the `23505` recovery branch works. *(Minor: it is indexed
  twice — `unique_reference_per_operator` and `transactions_unique_reference_per_operator`.)*
- **#16 (no indexes): repo-only.** 18 indexes exist live.
- **#14 (`audit_logs` never written): partially corrected.** The live `audit_transactions` trigger
  writes create/update/delete rows (26 present). **Still true:** no trigger on `wallets`, so manual
  balance overrides from Settings → Wallets remain completely unaudited.

### Confirmed live — and worse than reported
1. **Finding #1 upgraded from High to Critical: the exposure is `anon`, not `authenticated`.**
   All six `SECURITY DEFINER` functions carry the PostgreSQL default `EXECUTE` grant to `PUBLIC`
   (`proacl` shows a bare `=X/supabase_admin`), so `has_function_privilege('anon', …)` is **true**
   for every one. `gocash` is in `PGRST_DB_SCHEMAS`. **Not one of them references `auth.uid()`** —
   every one takes `p_operator_id` as a caller-supplied parameter.

   Verified end-to-end with the public anon key and no session:
   ```
   POST https://supabase.zether.net/rest/v1/rpc/update_wallet_balance
   → HTTP 400 {"code":"P0001","message":"Wallet not found: __probe__ (operator 000…000)"}
   ```
   The function body executed; only the random UUID stopped it. With a real `operator_id` and a
   guessable `wallet_name` ("GCash", "Cash"), an unauthenticated caller moves any balance by any
   amount. The same applies to `confirm_transaction_atomic`, `delete_platform_atomic`,
   `delete_transaction_atomic` and `upsert_operator` (which takes `p_user_id` directly).

   *Mitigating:* `operator_id` does not leak through PostgREST — RLS on `operators` yields no rows
   for `anon`. Practical exploitation needs an id from a network trace, log or screenshot. Any
   logged-in operator already knows their own, so the rules engine and the Phase-2 gate are
   bypassable by every user today.

   *Fix:* `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon, authenticated;` for all six (the Edge
   Functions use the service-role key and are unaffected), then add an `auth.uid()` ownership check
   inside each body as defence in depth.

2. **Finding #15 confirmed live: no UPDATE policy on any table has `WITH CHECK`** — `operators`,
   `wallets`, `transactions`, `transaction_rules`, `operator_platforms` all specify `USING` only.
3. **Finding #6 confirmed live (partially):** `transaction_rules` gained `rules_delete_own`, but
   **`wallets` and `transactions` still have no DELETE policy**. Deletion now goes through the
   `delete_*_atomic` RPCs instead — which is precisely why those are granted to `anon`.
4. **Finding #3 (double-confirm) confirmed live:** the live `confirm_transaction_atomic` still has
   no status guard in its transaction `UPDATE`.
5. **Live CORS is wide open — a regression against Audit #4's "CORS restricted" claim.**
   `main/_shared/cors.ts` hardcodes `Access-Control-Allow-Origin: "*"`. The repo's origin allowlist
   was never deployed. `VERIFY_JWT=true`, so this is defence-in-depth only.

### New findings (live only)
6. **The repo's seeded rules are inverted relative to production.** Live `Cash In` is
   `delta_platform_mult −1, delta_cash_amount_mult +1` (platform down, cash up — matching the OCR
   prompt). `onboarding/page.tsx:245` seeds `+1 / −1`. Cash Out and Profit Remittance are likewise
   flipped. **Any operator onboarded with current repo code gets backwards rules.** This settles
   Audit #5 finding #5: the live direction is correct, the repo seed is wrong.
7. **`detectType`'s Cash In / Cash Out keywords are swapped between repo and live.** Live maps
   "send money"/"you sent"/"sent to" → Cash In and "you received" → Cash Out; the repo does the
   reverse. The 37 repo tests assert the repo's (wrong) mapping.
8. **Live `calculateProfit` contains untested business logic that exists nowhere in the repo:** a
   Cash Out "gross amount already includes the fee" heuristic (`rawBase > 250` and divides to a
   whole peso) and `Math.ceil` rounding for Cash In / Cash Out. This is the most financially
   sensitive code in the system and has zero test coverage.
9. **Several live rules have `profit_rate` and `profit_minimum` NULL** (Bank Transfer, Bills
   Payment, Telco Load, Profit Remittance, and one operator's Cash In/Cash Out), so
   `calculateProfit` returns 0 for them. Verify this is intentional and not a seeding gap.
10. **Live `Profit Remittance` ('all') is `platform −1, cash +1`** while the Maya row is
    `platform 0, cash −1`. A remittance should remove cash; two of the three rows disagree.

### Scale context
`operators` 2 · `wallets` 8 · `transactions` **1** · `audit_logs` 26 · `operator_platforms` 6.
Effectively pre-production. Very little is at risk today, and the schema fixes are cheap right now.

### Follow-Ups
- [ ] **`REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` on all six `SECURITY DEFINER` functions; add `auth.uid()` checks inside each.**
- [ ] **Reconcile repo ↔ production: dump the live schema into migrations so the repo can rebuild it.** Until then the migrations are misleading, not merely incomplete.
- [ ] Update the repo's `confirm-transaction` to the live 18-arg RPC signature (or delete the stale copy and vendor `main/` into the repo).
- [ ] Fix the inverted `DEFAULT_RULES` in `onboarding/page.tsx` before onboarding another operator.
- [ ] Move `main/`'s logic into the repo and point the tests at it; add cases for the Cash Out gross-fee heuristic and `Math.ceil` rounding.
- [ ] Delete the four unserved function directories in the functions volume.
- [ ] Restore the CORS origin allowlist in `main/_shared/cors.ts`.
- [ ] Add `WITH CHECK` to every UPDATE policy; add a `wallets` audit trigger.
- [ ] Add the status guard to `confirm_transaction_atomic`.
- [ ] Drop the duplicate `(operator_id, reference_number)` index.
- [ ] Verify the `Profit Remittance` rule direction and the NULL profit rates.

---

## 2026-09-24 Audit #6 (Ledger Rebuild — Phase 0 and Phase 1)

### Scope
- Implementation audit across 15 commits on `feature/ledger-rebuild`, covering Phase 0
  (security, repo reconciliation) and Phase 1 (ledger, gate, shared core) of the plan.
- Nine review passes by separate reviewers: ledger correctness, security/tenancy, PRD
  conformance, n8n dependency, and an OCR replay harness.

### Validation Gates
- `pnpm run typecheck`: PASS (clean — including `supabase/functions/_core`, which tsconfig
  previously excluded and therefore never checked)
- `pnpm run test`: PASS (92) — 63 domain + 29 OCR replay. The 37 tests counted in every
  prior audit are **deleted**: they exercised `src/lib/transaction-processing.ts`, a stale
  copy that never ran in production (finding 4 of Audit #5).
- `npm run test:db`: PASS (27 assertions, mutation-tested — see below)
- `npx next build`: PASS (15 routes, static export)
- `deno check` on all Edge Functions: PASS (0 errors)
- `pnpm run lint`: still FAIL — no ESLint config. Open since Audit #1.

### Three findings from earlier audits were WRONG

Recording these because two of them were re-reported by independent reviewers during this
session, and one was nearly acted on.

1. **Audit #5 finding 15 / #5a item 2 — "no UPDATE policy has `WITH CHECK`, so a tenant can
   rewrite `operator_id` into another tenant's books" — is FALSE.** PostgreSQL uses the
   `USING` expression as the `WITH CHECK` when the latter is omitted for UPDATE. Verified
   directly against a policy of exactly that shape: as tenant A,
   `UPDATE t SET owner = <tenant B>` raises `new row violates row-level security policy`,
   while `UPDATE t SET note = 'edited'` succeeds. The five policies are safe. An explicit
   `WITH CHECK` is legibility only.
2. **"`authenticated` holds DELETE on five tables with no DELETE policy, so a user can
   delete their own audit rows" — FALSE.** RLS denies by default: `DELETE 0`, row survives.
3. **The `ALTER DEFAULT PRIVILEGES` fix in `20260923000001` did not work**, and its
   assertion passed anyway because it inspected `pg_default_acl` — the mechanism — instead
   of the outcome. Replaced with an event trigger and an assertion that creates a throwaway
   function, checks who can execute it, and drops it.

The pattern in all three: reasoning about grants while forgetting RLS's default-deny, or
asserting a mechanism rather than an outcome. **Every RLS claim in this session was tested
before being acted on.**

### Key Findings

**Closed and verified**
1. The anon RPC hole (Audit #5a finding 1) is closed. All 9 `gocash` functions:
   `anon=f, authenticated=f, service_role=t`. Verified end-to-end over HTTPS with the anon
   key AND a minted user JWT — the probe that previously executed the function body now
   returns `permission denied`. A DDL event trigger auto-revokes on every new function and
   procedure, because `ALTER DEFAULT PRIVILEGES` provably cannot remove PUBLIC's built-in
   EXECUTE on this Postgres.
2. The confirmation gate exists for the first time. `process-transaction` writes a draft and
   moves nothing; `confirm-transaction` posts one balanced entry behind a required
   idempotency key.
3. Four of six transaction types were silently destroying money (Telco Load, Bills Payment,
   Bank Transfer lost the principal; Profit Remittance was booked as a cash-in). The
   delta-multiplier model is replaced by postings that must sum to zero, enforced by a
   deferred constraint trigger.
4. Five further ledger holes found by review and closed, each demonstrated before and
   verified blocked after: cross-operator postings committing (with the victim reading a
   balance of 0 while the stored sum was not), legs appendable to an already-committed
   entry, no bound on `amount_minor` (one row broke `account_balances` for everyone), empty
   entries invisible to the health check, and `is_my_operator` relying on the event trigger
   for its revoke.
5. **A guard written as the fix pattern was itself a no-op.** `set_fee_rule` used
   `pg_has_role(current_user, 'service_role', 'MEMBER')`; inside a `SECURITY DEFINER`
   function `current_user` is the OWNER and that returns true for a superuser regardless of
   caller, so the ownership check never ran. Proven: tenant A could rewrite tenant B's
   pricing. Now reads the signed JWT claim. `session_user` would have failed identically —
   PostgREST connects as `authenticator`, also a member of `service_role`.

**Open, and material**
6. **NEW — the "balanced but wrong" class.** The zero-sum invariant proves an entry balances,
   not that it is correct. The OCR replay harness found 5 of 22 fixtures producing entries
   that sum to zero, pass every guard, and move the wrong money:
   - `detectType` has no "unknown"; its default is `return "Cash In"`. The types are mirror
     images, so a misdetected Cash Out **inverts** the entry — PHP 2,000 of error on a
     PHP 1,000 receipt.
   - Profit Remittance is absent from the extraction prompt's enum, so a JSON-mode model
     cannot return it. The one type where money leaves books the drawer +5,100 when 5,000
     left it, and never touches equity.
   - `ai.amount ?? 0` turns "could not read" into "was zero"; the PHP 5 floor then posts
     `cash +5 / revenue -5` — balanced, fictional, undetectable.
   - `detectPlatform` scans in platform order, not text order, so a MariBank receipt
     mentioning GCash drains GCash.
   - Nothing feeds the gross/net question into the fee calculation.
7. **The operator blacklist is half dead code.** It only runs when the model returned null,
   and one of its two hardcoded numbers can never match the regex it is checked against
   (`/(?:\+639|09)\d{9}/` — the number begins "13"). It has been a no-op since written.
8. **The customer-number regex is unanchored** and matched a mobile-shaped substring inside
   a reference number, fabricating a customer mobile on a receipt that had none.
   Date-prefixed references are the PH standard, so this fires seasonally.
9. **`public.documents` was world-readable and world-deletable** — RLS off, zero policies,
   `anon` holding SELECT and DELETE, returning rows unauthenticated over both REST and
   GraphQL. Not GoCash; same shared instance. RLS has since been enabled by the owner, but
   the anon grant remains, so one `DISABLE ROW LEVEL SECURITY` reopens it.
   `/home/zether/homelab/supabase/lockdown-public.sql` is written and unapplied.
10. **`public.remove_app_user_access` is an anon-callable escalation primitive** — SECURITY
    DEFINER, takes the actor's identity as a parameter, deletes admin rows.
11. **The `storage.objects` policies bind to `operators.name`**, a tenant-editable display
    name, instead of `objects.name`. An operator renaming themselves to `<their-uuid>/x`
    would read every receipt in the bucket. These policies exist only in the live database
    and in no migration.
12. **The rebuild plan's own reasoning was wrong** about the receipt-cleanup scheduler:
    `pg_cron` is already compiled into `supabase/postgres:15.8.1.085` and already in
    `shared_preload_libraries`, and `pg_net` is installed. Corrected in the plan and the PRD.

### Follow-Ups
- [ ] Fix the five balanced-but-wrong defects (finding 6). `detectType`'s default and
      `ai.amount ?? 0` are one-line changes with the largest consequences.
- [ ] De-hardcode and repair the operator blacklist (findings 7, 8) — Phase 2 moves it to
      `gocash.operator_numbers`; the exit criterion is zero references in the codebase.
- [ ] Apply `lockdown-public.sql` (findings 9, 10). Its two n8n pre-flights are moot — the
      document workflows fail at their first hop, `getaddrinfo ENOTFOUND paperless-ngx`.
- [ ] Fix the `storage.objects` policies and put them in a migration (finding 11). Applying
      breaks all 6 existing objects unless they are already under `<operator_id>/` paths.
- [ ] Apply migrations 0003–0007 to a scratch copy of live, stand up the trimmed stack, cut
      over. `wallets` holds the only copy of the balances until `0006` runs and verifies.
- [ ] Record 20 real receipt fixtures from a second operator. Worth more than anything else
      outstanding — the current OCR numbers measure the pipeline, not the model.
- [ ] Add `p_phone` to `provision_operator`; add a non-negative CHECK on opening balances.
- [ ] Finally add an ESLint config. Open since Audit #1.
