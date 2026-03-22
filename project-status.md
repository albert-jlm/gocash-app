# Project Status

> Tracks milestones, progress, and where we left off.
> Maintained by Claude. Update at the end of every session or after completing a feature.

---

## Current Status

**Active Milestone:** Milestone 1 — Cross-Platform Standalone App
**Overall Progress:** 🟢 Core app flow implemented and repo-green — `lint`, `typecheck`, `test`, and `build` all pass after Audit #5 remediation

---

## Milestones

### ✅ Milestone 1 — Cross-Platform Standalone App
**Goal:** A fully self-contained mobile app (iOS + Android + PWA) that replaces the n8n/Telegram workflow entirely. Operators upload screenshots, AI processes them, they review and save — done.
**Target Date:** TBD

#### Foundation
| Task | Status | Notes |
|---|---|---|
| PRD rewritten as standalone app spec (v4.0) | ✅ Done | n8n/Telegram FRs removed |
| TECH_SPEC updated (v3.0) | ✅ Done | Full Edge Function spec |
| architecture.md updated | ✅ Done | n8n removed; multi-app schema strategy documented |
| CLAUDE.md updated | ✅ Done | Static export constraint, Edge Function pipeline |
| Supabase `gocash` schema + RLS | ✅ Done | 5 tables + RLS + `update_wallet_balance` RPC + `user_id` on operators |
| Next.js 15 app scaffolded | ✅ Done | Static export, Tailwind, Shadcn/ui |
| Supabase client (gocash schema) + .env.local | ✅ Done | `createClient<Database, "gocash">` |

#### Auth & Onboarding
| Task | Status | Notes |
|---|---|---|
| Login screen (email + magic link) | ✅ Done | `src/app/login/page.tsx` — passwordless, `signInWithOtp` |
| `useAuthGuard` hook | ✅ Done | `src/hooks/useAuthGuard.ts` — checks session + operator record; redirects to `/login` or `/onboarding` |
| Onboarding flow (set opening wallet balances) | ✅ Done | `src/app/onboarding/page.tsx` — 2-step; creates operator platform catalog + GCash/MariBank/Maya/Cash wallets + default transaction rules |

#### AI Pipeline (Edge Functions)
| Task | Status | Notes |
|---|---|---|
| `_shared/transaction-processing.ts` — business logic | ✅ Done | detectPlatform, detectType, calculateProfit, extractAccountNumber, computeWalletDeltas |
| `_shared/cors.ts` — CORS helpers | ✅ Done | |
| `process-transaction` Edge Function | ✅ Done | Single GPT-4o extraction call; uploads private screenshot; dedup returns existing record; returns draft |
| `confirm-transaction` Edge Function | ✅ Done | Validates platform against active `operator_platforms`; atomic wallet updates; returns `confirmed` or `edited` |

#### Core Screens
| Task | Status | Notes |
|---|---|---|
| Capture screen | ✅ Done | `src/app/capture/page.tsx` — gallery + camera; calls `process-transaction`; processing overlay |
| Review & Save screen | ✅ Done | `src/app/confirm/[id]/` — server wrapper + client form; real Supabase data; edit mode |
| Dashboard | ✅ Done | `src/app/page.tsx` — realtime wallet/transaction refresh, stored wallet colors, pending badge, today's summary, recent tx |
| Transaction history | ✅ Done | `src/app/transactions/page.tsx` — realtime refresh, type filters, search, date-from/date-to filters |
| Transaction detail | ✅ Done | `src/app/transactions/[id]/page.tsx` — full read-only detail with signed screenshot preview; redirects pending → confirm |
| Settings (placeholder) | ✅ Done | `src/app/settings/page.tsx` — nav to sub-screens (not yet built) |

#### Wallet & Settings
| Task | Status | Notes |
|---|---|---|
| Wallet management screen | ✅ Done | `src/app/settings/wallets/page.tsx` — gradient cards, inline balance editing, persisted color customization |
| Profit settings (transaction rules editor) | ✅ Done | `src/app/settings/rules/page.tsx` — plain-language descriptions, rate/min editing, active toggle |
| Platform management | ✅ Done | `src/app/settings/platforms/page.tsx` — add/reactivate custom platforms; soft-delete inactive platform + wallet + rules |
| Notification settings | ✅ Done | `src/app/settings/notifications/page.tsx` — Telegram delivery preferences (`processed`, `processing_error`, chat ID); push notifications deferred |

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
| Unknown tx type defaults to "Cash In" | Low | Safe fallback but could mis-post; operator sees it on confirm screen |
| iOS Share Extension | Low | P2 — separate Xcode target, requires native extension |
| Notification delivery | Low | Telegram alerts are implemented when `TELEGRAM_BOT_TOKEN` is configured; push delivery is still deferred |
| Integration coverage | Low | Unit coverage is solid, but there is still no E2E test suite |
| `pnpm test` — 55 tests passing | — | Shared processing, storage, filter, platform, and notification helpers covered |

---

### ⬜ Milestone 2 — Multi-operator Onboarding
**Goal:** Other GoCash operators can sign up and use the app independently
**Target Date:** TBD

| Task | Status | Notes |
|---|---|---|
| Self-service operator signup | ⬜ | Schema already supports it; just needs signup UI |
| Subscription billing | ⬜ | Web-based to avoid App Store cut |
| Push notifications (APNs + FCM) | ⬜ | |
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

**Last session date:** 2026-03-22
**Last completed task:** Audit follow-up: Telegram delivery in `process-transaction` for processed/error events, plus added notification helper tests.
**Next task:** iOS Share Extension (P2), broader integration/E2E coverage, and push delivery.
**Open issues / blockers:**
- Native assets (`cap sync`) needed before next iOS/Android build
- No E2E test coverage yet for the main mobile flows
- Push delivery is still deferred

---

## Decisions Made

| Decision | Reason | Date |
|---|---|---|
| Next.js + Capacitor over Flutter | Single codebase for web + iOS + Android; React ecosystem | 2026-03-20 |
| Supabase over PlanetScale/Neon | Self-hosted; RLS handles multi-tenancy; Realtime needed | 2026-03-20 |
| Remove n8n entirely — AI pipeline in Supabase Edge Functions | Self-contained app; no homelab dependency | 2026-03-21 |
| Next.js as static export only | Required for Capacitor bundling; all backend in Edge Functions | 2026-03-21 |
| One Supabase instance, per-app PostgreSQL schemas | `gocash.*` schema isolates this app's tables | 2026-03-21 |
| Single-tenant first, multi-tenant schema from day one | No rewrite later; RLS + operator_id from the start | 2026-03-20 |
| Share-to-app input method (Android P1, iOS P2) | Natural mobile workflow — screenshot in GCash, share directly | 2026-03-22 |
| No timeout on unconfirmed transactions | Stay in "To Review" indefinitely; dashboard badge prevents misses | 2026-03-22 |
| Plain language UI throughout | Future operators are non-technical | 2026-03-22 |
| Magic link auth (no password) | Operators won't forget passwords; simpler onboarding | 2026-03-22 |
| `createClient<Database, "gocash">` | Explicit schema type param required for correct TypeScript inference on non-public schemas | 2026-03-22 |
