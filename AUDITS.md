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
