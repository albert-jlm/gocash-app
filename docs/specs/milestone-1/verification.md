# Verification Checklist — Milestone 1 (Retroactive)

> Retroactive record for Milestone 1 — Cross-Platform Standalone App.
> Code was built before this workflow was adopted. This document serves as the
> post-hoc verification record. All future features must spec first.

**Feature:** Milestone 1 — Complete standalone GoCash Tracker app
**Date:** 2026-03-23

---

## 1. Spec Compliance

| Criterion | Test Method | Result |
|-----------|-------------|--------|
| Operator can log in via magic link | Manual | ✅ |
| Operator completes onboarding (wallets + rules) | Manual | ✅ |
| Dashboard shows live wallet balances + pending badge | Manual | ✅ |
| Operator can capture a screenshot (gallery or camera) | Manual | ✅ |
| AI classifies transaction type, platform, amount | Automated (unit tests) | ✅ |
| Phase 1 writes draft transaction to DB | Manual | ✅ |
| Confirm screen shows draft; operator can edit + confirm | Manual | ✅ |
| Phase 2 updates wallet balances only after confirmation | Automated (unit tests) | ✅ |
| Transaction history shows all confirmed transactions | Manual | ✅ |
| Transaction detail shows full read-only record | Manual | ✅ |
| Settings: wallet balance inline editing | Manual | ✅ |
| Settings: profit rules editing (rate, min, active toggle) | Manual | ✅ |
| Settings: platform management (add/remove) | Manual | ✅ |
| Settings: Telegram notification toggle + chat ID | Manual | ✅ |
| Android share intent — share screenshot from GCash app | Manual | ✅ |
| iOS Share Extension — share screenshot from another app into GoCash | Manual / Native project review | ✅ |
| PWA installable with manifest + icons | Manual | ✅ |
| Capacitor iOS + Android projects are configured for native builds | Manual | ✅ |

---

## 2. Automated Gates

| Gate | Status |
|------|--------|
| TypeScript compiles (`pnpm typecheck`) | ✅ — zero errors |
| Lint passes (`pnpm lint`) | ✅ |
| Tests pass (`pnpm test`) | ✅ — 64/64 passing |
| Build succeeds (`pnpm build`) | ✅ — 15 pages exported |

---

## 3. Security Checks

> Milestone 1 includes auth, financial data, and AI pipeline — all Heavy Mode triggers.
> No formal threat model was written (workflow not yet adopted). Mitigations implemented:

- [x] Magic link auth — no passwords to leak or brute-force
- [x] RLS on every Supabase table — operator can only read/write their own data
- [x] OpenAI called server-side only (Edge Functions) — API key never exposed to client
- [x] No secrets hardcoded — all in `.env.local` and Supabase env vars
- [x] Two-phase model — wallet balances only change after explicit operator confirmation
- [x] Operator blacklist numbers checked in `transaction-processing.ts`
- [ ] `pnpm audit` not formally run — **run before any App Store submission**
- [ ] Threat model not written — **required for M2 features**

---

## 4. Manual Smoke Test

Happy path verified end-to-end:

1. Open app → redirected to `/login`
2. Enter email → receive magic link → tap link → authenticated
3. First-time user → redirected to `/onboarding` → set GCash, MariBank, Cash balances → operator + wallets created
4. Dashboard loads → wallet balances match onboarding input → pending badge shows 0
5. Capture screen → select screenshot from gallery → processing overlay → redirected to `/confirm/[id]`
6. Confirm screen → transaction pre-filled → edit amount → tap Confirm → redirected to dashboard
7. Dashboard → pending badge still 0 → wallet balance updated correctly
8. Transactions tab → confirmed transaction appears, date-grouped
9. Tap transaction → detail screen shows all fields read-only
10. Settings → Wallets → edit balance inline → saved

**Edge cases verified:**
- [x] Unknown transaction type defaults to "Cash In" with visible warning on confirm screen
- [x] Blacklisted account numbers are not stored as customer account numbers
- [x] Unconfirmed transactions stay in "To Review" indefinitely (no timeout)
- [x] Pending transaction from detail screen redirects to `/confirm/[id]`

---

## 5. Non-Goals (M1 Scope Boundary)

The following were explicitly out of scope and confirmed NOT implemented:

- App Store / Google Play submission
- Push notifications (APNs + FCM)
- Multi-operator onboarding / self-service signup
- Subscription billing
- Analytics, reporting, CSV export
- Multi-image batch upload

---

## Sign-off

- [x] All automated gates pass
- [x] Manual smoke test complete (end-to-end)
- [x] Security baselines implemented (formal threat model deferred to M2)
- [ ] PR process not followed — all committed directly to `main` (pre-workflow)
- [x] **Milestone 1 app code complete — ready for native signing/submission work, then Milestone 2**

---

> **Note:** From Milestone 2 onwards, every feature must follow the full workflow:
> spec → threat-model → plan → implement → security review → verify → PR
