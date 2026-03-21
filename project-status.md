# Project Status

> Tracks milestones, progress, and where we left off.
> Maintained by Claude. Update at the end of every session or after completing a feature.

---

## Current Status

**Active Milestone:** Milestone 1 — Cross-Platform Standalone App
**Overall Progress:** 🟡 In progress — Pre-build phase (docs complete, scaffolding next)

---

## Milestones

### 🔄 Milestone 1 — Cross-Platform Standalone App
**Goal:** A fully self-contained mobile app (iOS + Android + PWA) that replaces the n8n/Telegram workflow entirely. Operators upload screenshots, AI processes them, they review and save — done.
**Target Date:** TBD

#### Foundation
| Task | Status | Notes |
|---|---|---|
| PRD rewritten as standalone app spec (v4.0) | ✅ Done | n8n/Telegram FRs removed; new FRs for share sheet, wallet management, rules editor |
| TECH_SPEC updated (v3.0) | ✅ Done | Section 5.2 full Edge Function spec; Section 6 business logic reference |
| architecture.md updated | ✅ Done | n8n removed; multi-app schema strategy documented |
| CLAUDE.md updated | ✅ Done | Static export constraint, Edge Function pipeline, no-n8n documented |
| Supabase `gocash` schema + RLS | ⬜ Todo | Migration pending; 5 tables + triggers + default data |
| Next.js 15 app scaffolded | ⬜ Todo | Static export, Tailwind, Shadcn/ui |
| Supabase client (gocash schema) + .env.local | ⬜ Todo | |

#### Auth & Onboarding
| Task | Status | Notes |
|---|---|---|
| Login screen (email + magic link) | ⬜ Todo | |
| Onboarding flow (set opening wallet balances) | ⬜ Todo | First-time only; skipped if wallets already seeded |

#### AI Pipeline (Edge Functions)
| Task | Status | Notes |
|---|---|---|
| `lib/transaction-processing.ts` — business logic | ⬜ Todo | detectPlatform, detectType, calculateProfit, extractAccountNumber |
| `process-transaction` Edge Function | ⬜ Todo | Phase 1: OCR → classify → profit → DB write |
| `confirm-transaction` Edge Function | ⬜ Todo | Phase 2: wallet delta → balance update → snapshots |

#### Core Screens
| Task | Status | Notes |
|---|---|---|
| Capture screen | ⬜ Todo | Camera + photo picker + upload |
| Review & Save screen | ⬜ Todo | Pre-filled from AI; editable; Save → Phase 2 |
| Dashboard | ⬜ Todo | Wallet balances (Realtime) + "To Review" badge + today's summary |
| Transaction history | ⬜ Todo | List + filters (date, type, app, status) |
| Transaction detail | ⬜ Todo | All fields + original screenshot |

#### Wallet & Settings
| Task | Status | Notes |
|---|---|---|
| Wallet management screen | ⬜ Todo | View balances + manual adjustment |
| Platform management | ⬜ Todo | Add/remove apps (GCash, MariBank, custom) |
| Profit settings (transaction rules editor) | ⬜ Todo | Edit delta multipliers in plain language |
| Notification settings | ⬜ Todo | Telegram opt-in; push notifications (P1) |

#### Native Shell & Distribution
| Task | Status | Notes |
|---|---|---|
| Capacitor setup (iOS + Android) | ⬜ Todo | `com.gocash.tracker` bundle ID |
| `@capacitor/camera` integration | ⬜ Todo | Replaces browser file picker |
| Android share intent | ⬜ Todo | P1 — intent filter for ACTION_SEND image; `@capgo/send-intent` |
| iOS Share Extension | ⬜ Todo | P2 — separate Xcode target |
| PWA manifest + service worker | ⬜ Todo | |
| App Store submission (iOS) | ⬜ Todo | |
| Google Play submission (Android) | ⬜ Todo | |

---

### ⬜ Milestone 2 — Multi-operator Onboarding
**Goal:** Other GoCash operators can sign up and use the app independently (data already isolated via RLS)
**Target Date:** TBD

| Task | Status | Notes |
|---|---|---|
| Self-service operator signup | ⬜ | Schema already supports it; just needs signup UI |
| Subscription billing (web-based to avoid App Store cut) | ⬜ | |
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
**Last completed task:** PRD v4.0 + TECH_SPEC v3.0 rewritten; architecture.md + CLAUDE.md updated
**Next task:** Apply `gocash` schema migration to Supabase, then scaffold Next.js app
**Open issues / blockers:** None

---

## Decisions Made

| Decision | Reason | Date |
|---|---|---|
| Next.js + Capacitor over Flutter | Single codebase for web + iOS + Android; React ecosystem | 2026-03-20 |
| Supabase over PlanetScale/Neon | Self-hosted; RLS handles multi-tenancy; Realtime needed | 2026-03-20 |
| Remove n8n entirely — AI pipeline in Supabase Edge Functions | Self-contained app; no homelab dependency; fully distributable | 2026-03-21 |
| Next.js as static export only | Required for Capacitor bundling; all backend in Edge Functions | 2026-03-21 |
| One Supabase instance, per-app PostgreSQL schemas | No new instance per project; `gocash.*` schema isolates this app's tables | 2026-03-21 |
| Single-tenant first, multi-tenant schema from day one | No rewrite later; RLS + operator_id designed in from the start | 2026-03-20 |
| Share-to-app input method (Android P1, iOS P2) | Natural mobile workflow — screenshot in GCash, share directly to this app | 2026-03-22 |
| No timeout on unconfirmed transactions | Transactions stay in "To Review" indefinitely; dashboard badge; no silent failures | 2026-03-22 |
| Plain language UI throughout | Future operators are non-technical; every label must be self-explanatory | 2026-03-22 |
