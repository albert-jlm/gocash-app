# Verification Checklist — [Feature Name]

> Copy to `docs/specs/[feature-name]/verification.md` for each feature.
> Complete this before marking the feature as done and merging to main.

**Feature:** [feature name]
**Spec:** `docs/specs/[feature-name]/spec.md`
**Date:** [YYYY-MM-DD]

---

## 1. Spec Compliance

For each success criterion in `spec.md`:

| Criterion | Test Method | Result |
|-----------|------------|--------|
| [criterion 1] | [manual / automated] | ⬜ / ✅ / ❌ |
| [criterion 2] | [manual / automated] | ⬜ / ✅ / ❌ |

---

## 2. Automated Gates

Run these and confirm all pass:

```bash
# TypeScript
pnpm typecheck      # or: tsc --noEmit

# Lint
pnpm lint

# Unit/integration tests
pnpm test

# Build
pnpm build
```

| Gate | Status |
|------|--------|
| TypeScript compiles | ⬜ |
| Lint passes | ⬜ |
| Tests pass | ⬜ |
| Build succeeds | ⬜ |

---

## 3. Security Checks

For Heavy Mode features:
- [ ] Security review completed (`.ai/prompts/security-reviewer.md`)
- [ ] Threat model mitigations implemented (all T-items ✅)
- [ ] `pnpm audit` run — no critical/high vulnerabilities
- [ ] Secrets audit passed (no hardcoded credentials)
- [ ] Auth/authz tested with multiple user roles

---

## 4. Observability

- [ ] Key actions are logged (feature entry, errors, important state changes)
- [ ] No PII or secrets in logs
- [ ] Error responses use consistent format (no raw stack traces to clients)
- [ ] Metrics/traces added if this is a performance-sensitive path

---

## 5. Manual Smoke Test

Step-by-step instructions for a human to verify the happy path:

1. [e.g., Log in as a test user]
2. [e.g., Navigate to X]
3. [e.g., Perform action Y]
4. [e.g., Verify Z appears]
5. [e.g., Check the database/logs for expected state]

**Also test:**
- [ ] Error state (what happens when it fails?)
- [ ] Edge case: [describe]
- [ ] Mobile / responsive (if UI feature)

---

## 6. Non-Goals Confirmation

The following were explicitly out of scope and confirmed NOT implemented:
- [non-goal from spec 1]
- [non-goal from spec 2]

---

## Sign-off

- [ ] All automated gates pass
- [ ] Manual smoke test complete
- [ ] Security checks done (if applicable)
- [ ] PR created with spec referenced in description
- [ ] Ready to merge ✅
