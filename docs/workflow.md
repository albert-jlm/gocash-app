# Vibe Coding Workflow — Master Playbook

> This is the single-page reference for every feature you build.
> Run `/vibe-code` in Claude Code to get guided through this interactively.

---

## The Core Rule

> **No code before spec. No merge before verification.**

That's it. Everything else is detail.

---

## Mode Selection

Pick your mode BEFORE you start:

| Trigger | Mode |
|---------|------|
| UI tweak, copy change, style fix | **Light** |
| Small new component, script, CLI flag | **Light** |
| New page, new API endpoint, CRUD feature | **Heavy** |
| Auth, permissions, roles, tenant boundaries | **Heavy** |
| Payment flow, financial data | **Heavy** |
| File uploads, external webhooks | **Heavy** |
| AI/LLM integration, agent tools | **Heavy** |
| Anything touching user PII | **Heavy** |

**When in doubt → Heavy.**

---

## Light Mode (small features)

```
1. SPEC       Write spec.md (goal, success criteria, non-goals)
2. PLAN       Write plan.md (files to touch, slice sequence)
3. IMPLEMENT  Execute slice(s) with Codex
4. VERIFY     Run automated gates + quick smoke test
5. COMMIT     Conventional commit + PR
```

Time target: 1–2 hours per feature.

---

## Heavy Mode (new features, auth, data, APIs, AI)

```
1. SPEC         Write spec.md
                ↳ problem, success criteria, user flow, API changes, non-goals

2. THREAT MODEL Write threat-model.md
                ↳ assets, actors, entry points, trust boundaries, threats + mitigations

3. PLAN         Write plan.md
                ↳ vertical slices, files touched, migration strategy, rollback plan

4. IMPLEMENT    Execute ONE slice at a time with Codex
                ↳ DB → API → tests → UI → verify (per slice)
                ↳ Gate: typecheck + lint + tests must pass before next slice

5. SECURITY     Run security review (.ai/prompts/security-reviewer.md)
                ↳ OWASP Top 10 pass
                ↳ Threat model validation

6. VERIFY       Complete verification.md checklist
                ↳ All automated gates
                ↳ Manual smoke test

7. COMMIT       Conventional commit + PR with spec reference
```

---

## Claude Code vs Codex — Task Split

| Task | Tool |
|------|------|
| Read codebase, understand context | Claude Code |
| Draft spec.md | Claude Code |
| Draft threat-model.md | Claude Code |
| Break into vertical slices | Claude Code |
| Write plan.md | Claude Code |
| Execute one slice (write code) | **Codex** |
| Review diff against spec | Claude Code |
| Security pass | Claude Code |
| Run verification checklist | Claude Code |
| Refactor across multiple files | Claude Code |
| Generate boilerplate / repetitive edits | **Codex** |
| Write unit tests for a specific module | **Codex** |

**Pattern:**
> Claude plans → Codex executes → Claude reviews → CI decides

---

## Slice Execution Pattern

For every slice (backend-first rule):

```
1. DB migration / schema change
2. Data access layer (repository/query)
3. Service / business logic
4. API endpoint + input validation
5. Tests (unit or integration)
6. Frontend component / screen
7. E2E test or smoke verification
```

Never move to step N+1 until step N passes its gate.

---

## Document Map

```
docs/
  specs/
    [feature-name]/
      spec.md           ← written in SPEC phase
      plan.md           ← written in PLAN phase
      threat-model.md   ← Heavy Mode only
      verification.md   ← completed in VERIFY phase
  threat-models/
    TEMPLATE.md         ← copy when starting heavy features
  verification-template.md  ← copy when starting any feature
  workflow.md           ← this file

.ai/
  prompts/
    planner.md          ← Claude: spec + planning
    implementer.md      ← Codex: slice execution
    reviewer.md         ← Claude: diff review
    security-reviewer.md ← Claude: OWASP security pass
```

---

## Commit Convention

```
<type>(<scope>): <imperative description>

Types: feat | fix | refactor | test | docs | chore | security
Scope: module or feature name

Examples:
  feat(bookings): add driver assignment endpoint
  fix(auth): prevent token reuse after logout
  security(uploads): add HMAC validation on webhook
```

PR body must include:
- Link to `docs/specs/[feature]/spec.md`
- Verification checklist status (automated gates, smoke test)

---

## Security Baseline (Every App)

Non-negotiable defaults — enforce these even in Light Mode:

- Secrets live in `.env` only — never in code, logs, or prompts
- Auth/authz is explicit — never assumed or inherited
- User input is validated at the boundary — never trusted raw
- Logs never contain PII, tokens, or passwords
- Public endpoints have rate limiting
- Dependencies are audited (`pnpm audit`) before each release

---

## Scalability Baseline (Default Choices)

Start here, scale when you have real data:

- Monolith first, modular internally (split only on real org/scaling need)
- Stateless app processes (no in-memory session state)
- PostgreSQL as source of truth
- Cache only after measuring — don't cache speculatively
- Background queue for anything > 200ms
- Pagination on all list endpoints from day one
- Structured logging from day one (JSON, not free-text)

---

## Quick Reference

```
New session?           → /vibe-code
Need a spec?           → copy .ai/prompts/planner.md
Ready to implement?    → copy .ai/prompts/implementer.md
Reviewing a diff?      → copy .ai/prompts/reviewer.md
Security check?        → copy .ai/prompts/security-reviewer.md
Threat modeling?       → copy docs/threat-models/TEMPLATE.md
Ready to verify?       → copy docs/verification-template.md
```
