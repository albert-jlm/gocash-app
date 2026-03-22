# Audits Log

## Audit #5 Remediation Status Update — 2026-03-22

This repo has now landed the main Audit #5 fixes in code and verification:

- Dynamic operator platform catalog via `gocash.operator_platforms`
- Maya onboarding/backfill and wallet activation metadata
- Custom platform soft-delete flow
- Unique partial dedupe guard on `(operator_id, reference_number)`
- Private screenshot storage with signed URL rendering in transaction detail
- Wallet color persistence and realtime dashboard/history refresh
- Structured Telegram preferences with delivery in `process-transaction`
- Non-interactive ESLint CLI with CI gates for `lint`, `typecheck`, `test`, and `build`

Verification at this point:

- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — PASS (55 tests)
- `pnpm build` — PASS

Remaining product work after Audit #5 is now outside the original blocker set:

- iOS Share Extension (P2)
- Broader integration/E2E coverage

### Disposition of 2026-03-22 Audit #5 Findings

| Audit #5 Item | Status | Notes |
|---|---|---|
| 1. Custom platform management broken end-to-end | ✅ Implemented | Reworked to use `gocash.operator_platforms`, dynamic platform validation, and soft-delete/inactive platform handling instead of hard delete |
| 2. Maya not usable out of the box | ✅ Implemented | Onboarding now creates Maya, and migrations backfill missing Maya platform/wallet records for existing operators |
| 3. Duplicate receipt protection not enforced | ✅ Implemented | Added unique partial index on `(operator_id, reference_number)` for non-null references; duplicate processing returns the existing transaction |
| 4. Wallet color customization not actually shipped | ✅ Implemented | Added `wallets.color`, updated types, persisted wallet colors, and dashboard now renders from stored color values |
| 5. Notifications and live behavior incomplete | 🟡 Partially implemented | Supabase Realtime refresh is implemented, and Telegram processed/error delivery now runs from `process-transaction`; push delivery is still deferred |
| 6. Transaction list filters incomplete | ✅ Implemented | Added search plus `date from` / `date to` filtering on transaction history |
| 7. Transaction detail missing original screenshot | ✅ Implemented | Screenshots are stored in private Supabase Storage and displayed via short-lived signed URLs |
| 8. Date extraction architecture differs from spec | ✅ Resolved by spec alignment | The app still uses a single GPT-4o extraction call; docs were updated to reflect the shipped architecture |
| 9. ESLint not configured | ✅ Implemented | Added `eslint.config.mjs`, switched to ESLint CLI, and wired lint into CI |
| 10. Tests cover only business logic | 🟡 Partially implemented | Coverage expanded from 37 to 55 tests across shared helpers and processing logic, but there are still no integration or E2E tests |

### Disposition of Audit #5 Follow-Ups

- [x] Fix custom platform flow: replaced static allowlists with `operator_platforms`
- [x] Add DELETE RLS policies for `wallets` and `transaction_rules`
  This is no longer needed because platform removal now uses soft-delete via `is_active = false`
- [x] Auto-create Maya wallet during onboarding (and for existing operators via migration)
- [x] Add `UNIQUE(operator_id, reference_number)` protection to `transactions`
  Implemented as a unique partial index for non-null references
- [x] Add wallet `color` to schema + types + dashboard
- [x] Store screenshots in Supabase Storage and display in transaction detail
- [x] Add Supabase Realtime subscription for wallet balances on dashboard
- [x] Implement Telegram notification sending in an Edge Function
- [x] Add date range / search filters to transaction history
- [x] Finalize ESLint config
- [ ] Add integration and E2E tests

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

## 2026-03-22 Audit #5 (Tech Audit — PRD Compliance & End-to-End Integrity)

### Scope
- Full audit of PRD (v4.0) milestones and functional requirements against actual codebase.
- End-to-end flow verification for all features claimed as "Done" in `project-status.md`.
- Database schema, RLS policies, Edge Functions, and UI cross-checked for consistency.
- CI/CD pipeline (GitHub Actions) validated.

### Validation Gates
- `pnpm run typecheck`: PASS
- `pnpm run lint`: FAIL (interactive ESLint setup — `next lint` deprecated, no `eslint.config.*`)
- `pnpm run test`: PASS (37/37 tests in `transaction-processing.test.ts`)
- `pnpm run build`: PASS (static export, 15 routes)
- `pnpm audit --prod`: NOT RUN
- CI/CD pipeline: PASS (GitHub Actions build + deploy via Tailscale/rsync — run #23399972616, 1m03s)

### Key Findings (Severity-Ordered)

#### Critical — End-to-End Breakages

1. **Critical — Custom platform management is broken end-to-end.**
   The UI lets users add arbitrary platform names in `src/app/settings/platforms/page.tsx:87`, but the confirm flow and database only allow `GCash`, `MariBank`, `Maya`, and `Unknown`. Hard CHECK constraints exist in:
   - `20260322000001_initial_schema.sql:55` — `transactions.platform CHECK`
   - `supabase/functions/confirm-transaction/index.ts:144` — `VALID_PLATFORMS` allowlist
   - `src/app/confirm/[id]/confirm-form.tsx:253` — client-side dropdown
   Any custom platform (e.g. "ShopeePay") will fail at DB insert or Edge Function validation. Additionally, deleting a custom platform will fail silently because there are **no DELETE RLS policies** for `wallets` or `transaction_rules` in `20260322000002_rls_policies.sql:29`.

2. **Critical — Maya is not usable out of the box.**
   Onboarding only creates GCash, MariBank, and Cash wallets in `src/app/onboarding/page.tsx:113`, but the atomic confirm RPC hard-fails if the platform wallet does not exist (`20260322000003_functions_rpcs.sql:67`). A first Maya transaction will therefore fail until the user manually creates the Maya wallet via Settings > Platforms. This is a first-run blocker for any Maya transaction.

3. **Critical — Duplicate receipt protection is not enforced.**
   `process-transaction` expects a unique-constraint violation on duplicate `reference_number` (`supabase/functions/process-transaction/index.ts:254`), but there is **no UNIQUE constraint or index** on `(operator_id, reference_number)` in `20260322000001_initial_schema.sql:46`. The same receipt can be uploaded twice, saved twice, and double-confirmed — silently doubling wallet balance changes. The architecture doc and PRD both claim this protection exists.

#### High — Schema/Type Mismatches

4. **High — Wallet color customization is not actually shipped.**
   The settings screen reads and writes a `color` field in `src/app/settings/wallets/page.tsx:83`, but:
   - The column does not exist in the DB schema (`20260322000001_initial_schema.sql:30`)
   - The column is not in TypeScript types (`src/types/database.ts:116`)
   - The dashboard ignores any saved colors entirely, using hardcoded wallet styles (`src/app/page.tsx:18` — `WALLET_STYLES` map keyed by name)
   Even if the DB was patched manually, the dashboard would not use the saved values.

#### Medium — Incomplete Features

5. **Medium — Notifications and live behavior are incomplete.**
   - Notification settings screen (`src/app/settings/notifications/page.tsx:186`) saves preferences and explicitly marks push notifications as "Coming soon", but **no backend sends any notifications** — no Edge Function, no Telegram Bot API call, no APNs/FCM integration.
   - The dashboard (`src/app/page.tsx:137`) fetches data once on mount but does **not** subscribe to Supabase Realtime. Wallet balances won't update live if a transaction is confirmed in another tab/session. The PRD (FR-13) explicitly requires "live wallet balances via Supabase Realtime."

6. **Medium — Transaction list filters are incomplete.**
   FR-16 requires date range, search by amount/account/ref number. Only transaction type filter chips are implemented. No search functionality.

7. **Medium — Transaction detail missing original screenshot.**
   FR-17 requires showing the original screenshot image. The `image_url` column exists in the schema, but `process-transaction` does not upload the image to Supabase Storage — it processes the base64 inline and discards it. The detail page has no image display.

8. **Medium — Date extraction architecture differs from spec.**
   PRD specifies a two-model pipeline (GPT-4O for OCR, then gpt-4.1-mini for date/ref). Implementation uses a single GPT-4O call for everything. Functionally works but costs more per transaction than specified.

#### Low — Operational

9. **Low — ESLint not configured.**
   `pnpm run lint` is still interactive (`next lint` deprecated). No `eslint.config.*` file exists. CI does not run lint.

10. **Low — Tests cover only business logic.**
    37 unit tests for `transaction-processing.ts`. No integration tests for Edge Functions, no component tests for React pages, no E2E tests.

### PRD Milestone Status

| Milestone | Claimed Status | Actual Status |
|---|---|---|
| **M1 — Cross-Platform App** | Feature-complete | **~80% complete** — core flow works but 3 critical breakages (custom platforms, Maya, dedup) and several medium gaps |
| **M2 — Multi-operator Onboarding** | Not started | Not started |
| **M3 — Analytics & Reporting** | Not started | Not started |

### Follow-Ups
- [ ] Fix custom platform flow: either make the platform CHECK constraint dynamic, or switch to a foreign key to an `operator_platforms` table
- [ ] Add DELETE RLS policies for `wallets` and `transaction_rules`
- [ ] Auto-create Maya wallet during onboarding (and for existing operators via migration)
- [ ] Add `UNIQUE(operator_id, reference_number)` constraint to `transactions` table
- [ ] Remove `color` field from wallet settings UI or add the column to schema + types + dashboard
- [ ] Store screenshots in Supabase Storage and display in transaction detail
- [ ] Add Supabase Realtime subscription for wallet balances on dashboard
- [ ] Implement Telegram notification sending in an Edge Function
- [ ] Add date range / search filters to transaction history
- [ ] Finalize ESLint config
- [ ] Add integration and E2E tests
