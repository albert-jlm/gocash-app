# GoCash Transaction Tracker - Technical Specification

## Document Information

| Field | Value |
|-------|-------|
| Product Name | GoCash Transaction Tracker |
| Document Type | Technical Specification |
| Version | 3.1 |
| Status | Active — under correction mid-rebuild |
| Last Updated | 2026-09-23 |
| Related PRD | [PRD.md](./PRD.md) |

---

## Status as of 2026-09-23

**Large parts of this specification describe a system that does not exist.** It is being
corrected on `feature/ledger-rebuild`. Read alongside:

- `AUDITS.md` — Audit **#5** (full review) and **#5a** (live homelab verification, which
  corrects several #5 findings; production had drifted far ahead of the repo)
- `~/.claude/plans/i-think-the-whole-async-sparrow.md` — the approved rebuild plan

Known-wrong, corrected inline below:

| Section | Problem |
|---|---|
| §1.2 Current State | Describes n8n as current. n8n was removed from the pipeline in March 2026 |
| §2.1, §2.2, §3.1, §3.2, §5.3 | Supabase **Realtime** documented as a core dependency. Never used; being dropped |
| §3.3, §6.3 | Three per-type profit formulas including a ₱5 Telco ladder. **Fiction** — one formula, all types |
| §4.2 `initialize_operator_defaults` | Cash In / Cash Out delta directions are **inverted** |
| §4.2, §5.2 | Status spelled both `awaiting_confirm` and `awaiting_confirmation`. The live CHECK is `awaiting_confirm` |
| §4.2 whole DDL | Superseded by the ledger schema; also never matched production |
| §6.2 | Hardcodes an operator's account number in shipped classification logic |
| §6.5 | `computeDeltas` and the multiplier model are being deleted |
| §7.5 | `operator_devices` has never existed in any database |
| §8, §9 | The atomic-confirm function and the n8n migration strategy are both superseded |

**The single largest gap: the confirmation gate does not exist.** `main/_process_transaction.ts`
writes `status: "confirmed"` and moves balances in the same request.

---

## 1. System Overview

### 1.1 Product Vision

Transform the GoCash Transaction Tracker from a single-operator n8n workflow into a **multi-tenant SaaS platform** serving multiple GoCash operators through a **cross-platform mobile application** available on the web, iOS App Store, and Google Play Store — built from a single Next.js + Capacitor codebase.

### 1.2 Current State (**corrected 2026-09-23**)

The table that was here described the **2026-01 n8n era** and was already historical when
this document was written. n8n was removed from the pipeline in March 2026; the workflow ID
it quoted is dead. Actual current state:

| Aspect | Current Implementation |
|--------|------------------------|
| Architecture | Next.js static export + Capacitor; Supabase Edge Functions (Deno) |
| Tenancy | 2 operators, 8 wallets, **1 transaction**. Effectively pre-production |
| Storage | Supabase PostgreSQL, `gocash` schema, on the shared `supabase.zether.net` instance (migrating to a dedicated stack) |
| Interface | In-app screens; Telegram is notification-only |
| Processing | **Single-phase.** `main/_process_transaction.ts` OCRs, writes `status: "confirmed"` and moves balances in one request |
| AI Cost | 2 OpenAI calls per transaction (GPT-4o vision + gpt-4.1-mini), **unmetered and unmeasured** |
| Confirmation | **None.** `confirm-transaction` rejects anything not already confirmed and functions as an edit endpoint |
| Money model | 3 `delta_*` multiplier columns (−1/0/+1). **4 of 6 transaction types post wrong** — Telco Load −95, Bills Payment −95, Bank Transfer −100, Profit Remittance booked as a cash-in |
| Repo ↔ production | Production drifted far ahead (7 tables / 9 functions / 6 triggers / 18 indexes vs. the repo's 5/2/0/0). Baseline captured into migrations on 2026-09-23 |

### 1.3 Target State

| Aspect | Target Implementation |
|--------|----------------------|
| Architecture | Multi-tenant SaaS — Next.js web app + Capacitor native shell |
| Tenancy | Multiple operators (isolated data via RLS) |
| Storage | Supabase PostgreSQL with Row Level Security |
| Interface | iOS App + Android App + Web (PWA) — all from one codebase |
| Distribution | Apple App Store + Google Play Store + installable web PWA |
| Processing | Supabase Edge Functions handle full AI pipeline (OCR + classify + profit calc + DB write); no external workflow engine |
| Confirmation | In-app confirm/edit screen (replaces Telegram "Edit" form) |

---

## 2. Architecture Design

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GOCASH SAAS PLATFORM                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐  │
│   │   PWA Client    │   │   Admin Panel   │   │  Telegram Bot   │  │
│   │   (Next.js)     │   │   (Future)      │   │  (Notifications │  │
│   │                 │   │                 │   │   only, opt-in) │  │
│   └────────┬────────┘   └────────┬────────┘   └────────┬────────┘  │
│            │                     │                     │            │
│            └─────────────────────┼─────────────────────┘            │
│                                  ▼                                  │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │                    SUPABASE BACKEND                          │  │
│   │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐ │  │
│   │  │   Auth    │  │ Database  │  │  Storage  │  │   Edge    │ │  │
│   │  │  (Users)  │  │(PostgreSQL│  │  (Images) │  │ Functions │ │  │
│   │  │           │  │  + RLS)   │  │           │  │           │ │  │
│   │  └───────────┘  └───────────┘  └───────────┘  └───────────┘ │  │
│   │                                                              │  │
│   │  (Realtime was drawn here. It is not used and is being       │  │
│   │   dropped — verified zero call sites in src/.)               │  │
│   └──────────────────────────┬──────────────────────────────────┘  │
│                              │                                      │
│            ┌─────────────────┼─────────────────┐                   │
│            ▼                 ▼                 ▼                   │
│   ┌──────────────┐  ┌──────────────┐                               │
│   │  OpenAI API  │  │ Telegram API │                               │
│   │  (AI/OCR)    │  │  (Notify     │                               │
│   │              │  │   optional)  │                               │
│   └──────────────┘  └──────────────┘                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Request Flow (SaaS Target)

```
┌──────────┐    ┌──────────┐    ┌────────────────────────────────────────────┐
│ Operator │───▶│   PWA    │───▶│  Supabase Edge Fn: process-transaction     │
│ (Camera) │    │ (Upload) │    │  1. Store image in Supabase Storage        │
└──────────┘    └──────────┘    │  2. Call OpenAI GPT-4O → OCR text          │
                                │  3. Classify platform + type (TS code)     │
                                │  4. Calculate profit (TS code)             │
                                │  5. Extract account number (TS code)       │
                                │  6. Call OpenAI gpt-4.1-mini → date + ref  │
                                │  7. Upsert to transactions table           │
                                │  8. Return transaction ID                  │
                                └────────────────────┬───────────────────────┘
                                                     │
┌──────────┐    ┌─────────────────────────────────────┐    │
│  PWA     │◀───│    Supabase DB                       │◀───┘
│(Confirm  │    │ Transaction saved → status:          │
│  Screen) │    │ 'awaiting_confirm'  (NO ledger entry)│
└────┬─────┘    └─────────────────────────────────────┘
     │
     │ Operator reviews, optionally edits, then taps Confirm
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ Supabase Edge Fn: confirm-transaction                            │
│ • Apply pre-confirm edits to the transaction row                │
│   (not in the ledger yet, so no reversal needed)                │
│ • Resolve the effective fee_rules row                           │
│ • Build the balanced postings for the type                      │
│ • Insert ONE ledger_entries row + its postings, atomically,     │
│   guarded by an idempotency key                                 │
│ • Set status: 'confirmed'                                       │
└─────────────────────────────────────────────────────────────────┘

Plus, new:
  POST /void-transaction   → reversal entry, status 'voided',
                             enqueue receipt deletion
  POST /amend-transaction  → reversal + new entry; both retained
```

> 🔴 **TARGET, not current.** Today `process-transaction` writes `'confirmed'` and moves
> balances itself; `confirm-transaction` edits already-confirmed rows via the live
> 18-argument `confirm_transaction_atomic`. Ledger tables reject DELETE, so
> `delete_transaction_atomic` cannot be ported — that is deliberate, it was the source of
> the orphaned receipts.

### 2.3 Transaction Status Lifecycle

```
[uploaded] → [processing] → [awaiting_confirm] → [confirmed] → [voided]
                                               ↘ [edited] (confirmed with changes)
                    ↘ [failed] (any Phase 1 error)
```

**`awaiting_confirm` is the correct spelling** — it is what the live CHECK constraint
accepts. `awaiting_confirmation` appears in `PRD.md` and in §5.2 of this document; no
database has ever accepted it, and the mismatch broke the pending/review flow (AUDITS #2).

| Status | Meaning | Balance Moved? |
|--------|---------|----------------|
| `uploaded` | Image received, processing not yet started | No |
| `processing` | Edge Function AI pipeline running | No |
| `awaiting_confirm` | AI done, transaction saved as a draft, waiting for operator | No |
| `confirmed` | Operator confirmed | **Yes** — one balanced ledger entry |
| `edited` | Operator confirmed with edits | **Yes** |
| `voided` | Reversed after confirmation | Reversal entry posted; net zero |
| `failed` | Processing error | No |

> `'edited'` is in the live CHECK and is queried by the dashboard, but nothing ever sets it
> — confirm always writes `'confirmed'` and tracks edits via `was_edited`. Either wire it
> up or drop it from the enum; do not leave it half-real.

> ⚠️ **Key architectural constraint**: balances are NEVER updated before status reaches
> `confirmed` or `edited`. Transactions stuck in `awaiting_confirm` represent incomplete
> records; operators are alerted about pending confirmations via the dashboard badge.
>
> 🔴 **Currently violated.** `_process_transaction.ts` writes `confirmed` directly and
> `awaiting_confirm` is never written by anything. Restoring this is plan Phase 1.2. The
> one sanctioned exception, once restored, is `operators.settings.auto_confirm_below_minor`
> (default 0 = off).

---

## 3. Component Specifications

### 3.1 Cross-Platform Client (Next.js + Capacitor)

#### Architecture Decision: Capacitor over React Native

Capacitor wraps the Next.js web app in a native shell for iOS and Android, while also running as a standard PWA in the browser. This means **one UI codebase ships to three platforms**: iOS App Store, Google Play Store, and web.

| Option | Considered? | Decision |
|--------|------------|---------|
| **Capacitor** (wrap Next.js) | ✅ | **Selected** — one codebase, all platforms |
| Expo / React Native | Considered | Rejected — separate UI codebase, high duplication |
| TWA (Trusted Web Activity) | Considered | Rejected — Play Store only, no iOS App Store |
| Pure PWA only | Considered | Rejected — iOS App Store requires a native shell |

#### Technology Stack

| Component | Technology | Version | Notes |
|-----------|------------|---------|-------|
| Framework | Next.js (App Router) | 15.x | Web layer |
| UI Library | React | 19.x | |
| Styling | Tailwind CSS | 4.x | |
| Components | shadcn/ui | Latest | |
| State Management | TanStack Query + Zustand | 5.x / 5.x | |
| Form Handling | React Hook Form + Zod | 7.x / 3.x | |
| ~~Realtime~~ | ~~Supabase Realtime~~ | — | **Not used. Being dropped** — zero `.channel(`/`.subscribe()` call sites in `src/` |
| **Native Shell** | **Capacitor** | **6.x** | **iOS + Android wrapper** |
| Native Camera | `@capacitor/camera` | 6.x | Replaces WebRTC camera |
| Push Notifications | `@capacitor/push-notifications` | 6.x | APNs (iOS) + FCM (Android) |
| Haptics | `@capacitor/haptics` | 6.x | Tactile feedback on confirm |
| Storage (offline) | `@capacitor/preferences` | 6.x | Local key-value for offline queue |
| Biometrics (optional) | `@capacitor-mlkit/face-detection` or `@capacitor/biometric` | Latest | Lock screen for sensitive data |
| PWA fallback | next-pwa | Latest | Web-only install (no native) |

#### How Capacitor Works in This Stack

```
┌─────────────────────────────────────────────────────┐
│                   Next.js App                        │
│           (runs in Capacitor WebView)                │
│   React components, Tailwind, Supabase SDK           │
└───────────────────────┬─────────────────────────────┘
                        │  Capacitor Bridge (JS ↔ Native)
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
   ┌─────────────┐ ┌──────────┐ ┌──────────┐
   │   Camera    │ │  Push    │ │  Haptics │
   │  (Native)   │ │  Notifs  │ │  + more  │
   └─────────────┘ └──────────┘ └──────────┘
          │             │             │
    iOS (Swift)   Android (Kotlin)   Both
```

> The same JavaScript code that runs in the browser calls `Camera.getPhoto()` from `@capacitor/camera`. On web it falls back to WebRTC. On iOS it opens the native camera. On Android it uses the system camera intent. **No conditional code needed** — Capacitor handles the platform detection.

#### Features

| Feature | Description | Priority | iOS | Android | Web |
|---------|-------------|----------|-----|---------|-----|
| Camera Capture | Native camera via `@capacitor/camera` | P0 | ✅ | ✅ | ✅ (WebRTC) |
| Image Upload | Supabase Storage → `process-transaction` Edge Function (n8n is not involved) | P0 | ✅ | ✅ | ✅ |
| Confirm Screen | Review + edit AI results + Confirm | P0 | ✅ | ✅ | ✅ |
| Transaction List | History with filters/search | P0 | ✅ | ✅ | ✅ |
| Balance Dashboard | Real-time wallet balances | P0 | ✅ | ✅ | ✅ |
| Pending Alerts | Warn about `awaiting_confirm` transactions | P0 | ✅ | ✅ | ✅ |
| Push Notifications | APNs (iOS) + FCM (Android) via Capacitor | P1 | ✅ | ✅ | ⚠️ (Web Push, limited iOS) |
| Haptic Feedback | On confirm button tap | P1 | ✅ | ✅ | ❌ |
| Offline Queue | Queue uploads when offline | P1 | ✅ | ✅ | ✅ |
| App Store / Play Store | Distributed as native app | P0 | ✅ | ✅ | N/A |
| Dark Mode | System dark mode respects | P2 | ✅ | ✅ | ✅ |

#### Screen Specifications

| Screen | Route | Description | Key Actions |
|--------|-------|-------------|-------------|
| Login | `/login` | Email/magic link auth | Sign in, magic link |
| Dashboard | `/` | Wallet balances, today's transactions, pending alerts | Upload / capture |
| Capture | `/capture` | Native camera via `@capacitor/camera` | Take photo, re-take, upload |
| Confirm | `/confirm?id=...` | Review AI results, edit if needed, confirm | Edit fields, Confirm |
| Transactions | `/transactions` | Full history with filters | Filter, search |
| Transaction Detail | `/transactions?id=...` | View single transaction, re-confirm if pending | Edit, re-confirm |

> Routes are **query-param based**, not dynamic segments. Static export cannot generate
> `/confirm/[id]` for real UUIDs. `transactions/[id]/page.tsx` still exists in the tree and
> is unreachable — `generateStaticParams` emits only `/transactions/preview`.
| Settings | `/settings` | User prefs, Telegram notifications, account | Save prefs |

#### Capacitor Configuration (`capacitor.config.ts`)

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gocash.tracker',
  appName: 'GoCash Tracker',
  webDir: 'out',               // Next.js static export output directory
  server: {
    androidScheme: 'https',    // Required for Supabase auth cookies on Android
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Camera: {
      // iOS: add to Info.plist — NSCameraUsageDescription
      // Android: CAMERA permission added automatically
    },
  },
  ios: {
    scheme: 'GoCash',
  },
};

export default config;
```

> ⚠️ **Next.js Static Export Required**: Capacitor bundles the app as static files. Next.js must be configured with `output: 'export'` in `next.config.js`. This means **no Server-Side Rendering** — all data fetching must happen client-side (which is already the case — via the Supabase client SDK, fetched on navigation; Realtime is not used).

#### Native Camera Usage (with Capacitor)

```typescript
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

async function captureTransactionScreenshot() {
  const image = await Camera.getPhoto({
    quality: 90,
    allowEditing: false,
    resultType: CameraResultType.Base64,
    source: CameraSource.Photos,   // Opens photo picker (for screenshots)
    // Or: CameraSource.Camera     // Opens live camera
  });

  // image.base64String is ready to send to n8n webhook
  return image.base64String;
}
```

#### Push Notification Setup — **NOT BUILT**

> The `operator_devices` table this writes to has never existed. See §7.5.

```typescript
import { PushNotifications } from '@capacitor/push-notifications';

// Called on app startup
async function initPushNotifications(userId: string) {
  const result = await PushNotifications.requestPermissions();

  if (result.receive === 'granted') {
    await PushNotifications.register();
  }

  // Save device token to Supabase for server-side targeting
  PushNotifications.addListener('registration', async (token) => {
    await supabase
      .from('operator_devices')
      .upsert({ operator_id: userId, token: token.value, platform: Capacitor.getPlatform() });
  });

  // Handle foreground notifications
  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    // e.g., "Transaction ready to confirm" → navigate to /confirm/[id]
  });
}
```

#### PWA Manifest (Web fallback)

```json
{
  "name": "GoCash Transaction Tracker",
  "short_name": "GoCash",
  "description": "AI-powered transaction tracking for GCash operators",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ffffff",
  "theme_color": "#0066ff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### 3.2 Supabase Backend

#### Services Used

| Service | Purpose | Notes |
|---------|---------|-------|
| **Auth** | User registration, login, session management | Magic link + email/password |
| **Database** | PostgreSQL with Row Level Security | All business data |
| **Storage** | Transaction screenshot images | `transaction-images` bucket |
| **Edge Functions** | Processing trigger + confirmation logic | Deno runtime. Only `main/` is served — `--main-service /home/deno/functions/main`; sibling directories are never executed |
| ~~**Realtime**~~ | ~~Live balance + transaction status updates to PWA~~ | **Not used; dropped from the new stack.** Balances are refresh-on-navigate (~123 MiB saved) |

#### Auth Configuration

```typescript
// Supported auth methods
const authMethods = {
  email: true,           // Email + password
  magicLink: true,       // Passwordless email link
  phone: false,          // Future: OTP via SMS
  google: false,         // Future: Social login
};

// Session configuration
const sessionConfig = {
  expiresIn: 3600 * 24 * 7,  // 7 days
  refreshThreshold: 3600,     // Refresh when < 1 hour remaining
};
```

> ⚠️ **Auth + RLS Design**: The `operators` table uses the Supabase Auth user's `id` (UUID) directly as the operator's primary key. This means `auth.uid() = operators.id` is always true for the correct row. RLS policies leverage this directly. The n8n webhook and Edge Functions use the `service_role` key to bypass RLS for server-side writes.

#### Storage Buckets

| Bucket | Purpose | Access |
|--------|---------|--------|
| `transaction-images` | Screenshot uploads | Authenticated only; signed URLs for Edge Function access |
| `profile-avatars` | User profile pictures | Public |

### 3.3 AI Processing Pipeline (Supabase Edge Functions)

All AI processing runs inside Supabase Edge Functions — no external workflow engine. The app is fully self-contained.

#### Edge Functions

| Function | Trigger | Responsibility |
|----------|---------|---------------|
| `process-transaction` | Called by PWA after image upload | Full Phase 1: OCR → classify → profit calc → account extraction → date/ref extraction → DB upsert |
| `confirm-transaction` | Called by PWA when operator confirms | Full Phase 2: update transaction → compute wallet deltas → update wallets → write snapshots |

#### `process-transaction` Flow

```typescript
// supabase/functions/process-transaction/index.ts
// Receives: { transaction_id, image_base64 }
// Auth: operator JWT (RLS enforced)

1. Decode base64 → call OpenAI GPT-4O (vision) → raw OCR text
2. Classify platform (GCash | MariBank | Unknown) via keyword matching
3. Classify transaction type (Cash In | Cash Out | Telco Load | Unknown) via keyword matching
4. Calculate profit using business rules (Cash In / Cash Out / Telco Load formulas)
5. Extract account number (regex, with operator blacklist)
6. Call OpenAI gpt-4.1-mini → extract date + reference number
7. Upsert to transactions table (dedup on reference_number + operator_id)
8. Update transaction status: 'processing' → 'awaiting_confirm'
9. Return { transaction_id, platform, type, amount, profit, account, reference }
```

#### Business Logic (ported from n8n Code nodes to TypeScript)

```typescript
// lib/transaction-processing.ts — shared logic used by Edge Function

// Platform detection
function detectPlatform(ocrText: string): 'GCash' | 'MariBank' | 'Unknown' { ... }

// Transaction type detection
function detectType(ocrText: string, platform: string): TransactionType { ... }

// Fee calculation — ONE formula for all six types, resolved from fee_rules
// (rate_bps = 200, minimum_minor = 500). See §6.3 for the full corrected version.
function calculateFee(txType, platform, amountMinor, rules): Minor { ... }

// Account number extraction (blacklists the operator's own numbers)
// The numbers are NOT listed here — see §6.4.
function extractAccountNumber(ocrText: string): string | null { ... }
```

> 🔴 **Corrected.** The per-type `calculateProfit` switch that was here — with a distinct
> Cash Out base calculation and a Telco Load "round up to the next ₱5" ladder — described
> pricing that does not exist. There is **one** formula:
> `ceil(max(amount × 2%, ₱5))`, for all six types.

> **Where the logic lives:** `supabase/functions/_core/` (`money.ts`, `postings.ts`,
> `fees.ts`, `types.ts`) — Deno-compatible, zero runtime deps, imported directly by the
> Edge Functions and by Next.js through a tsconfig path alias.
>
> `lib/transaction-processing.ts` referenced above was a **copy-paste that diverged from
> the deployed copy**, and all 37 of its Vitest tests exercised code that never ran in
> production (AUDITS #5 finding 4). It is being deleted.

---

## 4. Database Schema

### 4.1 Entity Relationship Diagram

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    operators    │     │  transactions   │     │     wallets     │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ id (PK=auth.uid)│◀────│ operator_id (FK)│     │ id (PK)         │
│ email           │     │ id (PK)         │     │ operator_id (FK)│
│ name            │     │ type            │     │ wallet_name     │
│ telegram_chat_id│     │ platform        │     │ wallet_type     │
│ settings        │     │ amount          │     │ balance         │
│ subscription_tier│    │ net_profit      │     │ updated_at      │
│ created_at      │     │ reference_number│     └─────────────────┘
└─────────────────┘     │ account_number  │
        │               │ transaction_date│     ┌─────────────────┐
        │               │ time_24hr       │     │transaction_rules│
        │               │ full_date       │     ├─────────────────┤
        │               │ image_url       │     │ id (PK)         │
        │               │ status          │     │ operator_id (FK)│
        │               │ was_edited      │     │ transaction_type│
        │               │ starting_cash   │     │ delta_platform  │
        │               │ wallet_balance  │     │ delta_cash_amt  │
        └──────────────▶│ confirmed_at    │     │ delta_cash_prof │
                        │ created_at      │     └─────────────────┘
                        └─────────────────┘
```

### 4.2 Full SQL DDL

> 🔴 **This DDL is superseded and never matched production.** It is retained as the record
> of the model being replaced. Two things to know before reading it:
>
> 1. **It was never the live schema.** Production was built by hand and ran ahead of it:
>    7 tables, 9 functions, 6 triggers, 18 indexes, and a different
>    `confirm_transaction_atomic` signature. The captured baseline is
>    `supabase/migrations/20260923000000_baseline_gocash.sql`.
> 2. **The seeded `transaction_rules` below have Cash In and Cash Out backwards** — see the
>    correction on that block.
>
> The replacement is `accounts` / `ledger_entries` / `postings` / `account_balances` +
> `fee_rules` (migrations `20260924000001` and `20260924000002`). `wallets`,
> `transaction_rules`, `update_wallet_balance`, `confirm_transaction_atomic`, both
> `delete_transaction_atomic` overloads and `initialize_operator_defaults` are dropped.
> `transactions` loses `starting_cash`, `wallet_balance`, `time_24hr`, `full_date`, `year`,
> `month`, `day`.

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- OPERATORS TABLE (Tenants)
-- NOTE: id = auth.uid() from Supabase Auth — not auto-generated
-- =============================================================================
CREATE TABLE operators (
    id UUID PRIMARY KEY,  -- Must equal auth.uid() — set on INSERT by client
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    telegram_chat_id TEXT,  -- Operator's personal Telegram chat ID for notifications
    settings JSONB DEFAULT '{
        "notifications": {
            "telegram": false,
            "push": true,
            "email": false
        },
        "timezone": "Asia/Manila",
        "currency": "PHP"
    }'::jsonb,
    subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'basic', 'premium')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_operators_email ON operators(email);
CREATE INDEX idx_operators_telegram ON operators(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- =============================================================================
-- TRANSACTIONS TABLE
-- Two-phase write: Phase 1 writes core fields, Phase 2 writes wallet snapshots
-- =============================================================================
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,

    -- Core transaction data (written in Phase 1 — AI processing)
    transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'Cash In', 'Cash Out', 'Telco Load',
        'Bills Payment', 'Bank Transfer', 'Profit Remittance', 'Unknown'
    )),
    platform TEXT NOT NULL DEFAULT 'Unknown' CHECK (platform IN ('GCash', 'MariBank', 'Unknown')),
    account_number TEXT,                       -- NULL if not detected (allowed)
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    net_profit DECIMAL(15, 2) DEFAULT 0,
    reference_number TEXT,

    -- Timestamps (written in Phase 1)
    transaction_date TIMESTAMPTZ,              -- UTC; parsed from receipt, Asia/Manila assumed
    time_24hr TEXT,                            -- e.g. "14:30"
    full_date TEXT,                            -- e.g. "March-08-2025"
    -- Generated from transaction_date (no need to write manually):
    year TEXT GENERATED ALWAYS AS (EXTRACT(YEAR FROM transaction_date)::TEXT) STORED,
    month TEXT GENERATED ALWAYS AS (EXTRACT(MONTH FROM transaction_date)::TEXT) STORED,
    day TEXT GENERATED ALWAYS AS (EXTRACT(DAY FROM transaction_date)::TEXT) STORED,

    -- Processing metadata
    image_url TEXT,                            -- Supabase Storage path
    status TEXT DEFAULT 'uploaded' CHECK (status IN (
        'uploaded',          -- Image received
        'processing',        -- AI pipeline running (Edge Function)
        'awaiting_confirm',  -- Phase 1 done, waiting for operator confirm
        'confirmed',         -- Operator confirmed (no edits)
        'edited',            -- Operator confirmed with edits
        'failed'             -- Processing error
    )),
    was_edited BOOLEAN DEFAULT false,
    edit_history JSONB DEFAULT '[]'::jsonb,    -- Array of {field, old, new, timestamp}
    processing_errors TEXT[],

    -- Wallet snapshots (written in Phase 2 — AFTER confirmation only)
    -- NULL if transaction never confirmed (status = awaiting_confirm or failed)
    starting_cash DECIMAL(15, 2),             -- Cash wallet balance BEFORE cash update
    wallet_balance DECIMAL(15, 2),            -- Platform wallet balance AFTER update

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    confirmed_by TEXT,                         -- 'operator' or future: 'auto'

    -- Deduplication: same reference number cannot appear twice per operator
    CONSTRAINT unique_reference_per_operator UNIQUE (operator_id, reference_number)
);

-- Indexes for common queries
CREATE INDEX idx_transactions_operator ON transactions(operator_id);
CREATE INDEX idx_transactions_date ON transactions(transaction_date DESC);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_type ON transactions(transaction_type);
CREATE INDEX idx_transactions_platform ON transactions(platform);
CREATE INDEX idx_transactions_reference ON transactions(reference_number) WHERE reference_number IS NOT NULL;
CREATE INDEX idx_transactions_operator_date ON transactions(operator_id, transaction_date DESC);

-- Index for pending confirmations (PWA will poll/subscribe to this)
CREATE INDEX idx_transactions_pending ON transactions(operator_id, created_at DESC)
    WHERE status = 'awaiting_confirm';

-- =============================================================================
-- WALLETS TABLE
-- =============================================================================
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    wallet_type TEXT NOT NULL CHECK (wallet_type IN ('platform', 'cash')),
    wallet_name TEXT NOT NULL,                 -- 'GCash', 'MariBank', 'Cash'
    balance DECIMAL(15, 2) DEFAULT 0,
    last_transaction_id UUID REFERENCES transactions(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_wallet_per_operator UNIQUE (operator_id, wallet_name)
);

CREATE INDEX idx_wallets_operator ON wallets(operator_id);

-- =============================================================================
-- TRANSACTION RULES TABLE
-- Mirrored the n8n-era "GoCash Tx Rules" data table (long since removed).
-- delta_platform_mult, delta_cash_amount_mult, delta_cash_mult
-- 🔴 This whole table is being replaced by gocash.fee_rules. The three delta_*
--    columns only ever held -1/0/+1 and encoded DIRECTION as configurable data,
--    which is why 4 of 6 transaction types were wrong in production.
-- =============================================================================
CREATE TABLE transaction_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL,
    platform TEXT DEFAULT 'all',               -- 'GCash', 'MariBank', 'all'

    -- Wallet delta multipliers (match n8n field names)
    delta_platform_mult DECIMAL(10, 6) DEFAULT 0,      -- × amount → platform wallet change
    delta_cash_amount_mult DECIMAL(10, 6) DEFAULT 0,   -- × amount → cash wallet change
    delta_cash_mult DECIMAL(10, 6) DEFAULT 0,          -- × profit → cash wallet change

    -- Profit calculation (null = use hardcoded formula in workflow)
    profit_rate DECIMAL(10, 6),
    profit_minimum DECIMAL(15, 2),

    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_rule_per_operator UNIQUE (operator_id, transaction_type, platform)
);

CREATE INDEX idx_rules_operator_type ON transaction_rules(operator_id, transaction_type);

-- =============================================================================
-- AUDIT LOGS TABLE
-- =============================================================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id UUID REFERENCES operators(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,     -- 'transaction', 'wallet', 'operator', 'rule'
    entity_id UUID NOT NULL,
    action TEXT NOT NULL,          -- 'create', 'update', 'confirm', 'edit', 'fail'
    changes JSONB,                 -- { field: { old: x, new: y } }
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_operator ON audit_logs(operator_id);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- =============================================================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================================================

ALTER TABLE operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- OPERATORS: id = auth.uid() always
CREATE POLICY "operators_select_own" ON operators
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "operators_insert_own" ON operators
    FOR INSERT WITH CHECK (auth.uid() = id);   -- CRITICAL: prevent inserting as someone else

CREATE POLICY "operators_update_own" ON operators
    FOR UPDATE USING (auth.uid() = id);

-- TRANSACTIONS: operator_id = auth.uid()
CREATE POLICY "transactions_select_own" ON transactions
    FOR SELECT USING (operator_id = auth.uid());

CREATE POLICY "transactions_insert_own" ON transactions
    FOR INSERT WITH CHECK (operator_id = auth.uid());

CREATE POLICY "transactions_update_own" ON transactions
    FOR UPDATE USING (operator_id = auth.uid());

-- WALLETS: operator_id = auth.uid()
CREATE POLICY "wallets_select_own" ON wallets
    FOR SELECT USING (operator_id = auth.uid());

CREATE POLICY "wallets_update_own" ON wallets
    FOR UPDATE USING (operator_id = auth.uid());

-- TRANSACTION RULES: operator_id = auth.uid()
CREATE POLICY "rules_select_own" ON transaction_rules
    FOR SELECT USING (operator_id = auth.uid());

CREATE POLICY "rules_insert_own" ON transaction_rules
    FOR INSERT WITH CHECK (operator_id = auth.uid());

CREATE POLICY "rules_update_own" ON transaction_rules
    FOR UPDATE USING (operator_id = auth.uid());

CREATE POLICY "rules_delete_own" ON transaction_rules
    FOR DELETE USING (operator_id = auth.uid());

-- AUDIT LOGS: read-only for users
CREATE POLICY "audit_select_own" ON audit_logs
    FOR SELECT USING (operator_id = auth.uid());

-- NOTE: Service role key (used by the Edge Functions) bypasses RLS by default.
-- Never expose service_role key to the client. Use anon key in the PWA.
--
-- 🔴 TWO DEFECTS IN THE POLICIES ABOVE, both confirmed live (AUDITS #5 #15, #5a):
--
-- 1. Every UPDATE policy specifies USING only, with NO WITH CHECK. A user can update a
--    row they own and set operator_id (or operators.user_id) to another tenant's id,
--    writing rows into someone else's ledger. It also lets a user set their own
--    subscription_tier. Add WITH CHECK to all of them.
--
-- 2. Nothing here REVOKEs EXECUTE on the SECURITY DEFINER functions. All six live ones
--    carried the PostgreSQL default grant to PUBLIC, making them callable with the
--    public anon key and NO session -- verified end to end. None reference auth.uid();
--    all take p_operator_id as a caller-supplied parameter. Fixed on this branch by
--    20260923000001_revoke_public_execute.sql and 20260923000002_default_privileges.sql.
--
-- CI asserts this generically so the next function added without a REVOKE is caught:
--    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'gocash' AND has_function_privilege('anon', p.oid, 'EXECUTE');
-- must return zero rows, forever.

-- =============================================================================
-- UTILITY FUNCTIONS & TRIGGERS
-- =============================================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_operators_timestamp
    BEFORE UPDATE ON operators
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_transactions_timestamp
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_wallets_timestamp
    BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_rules_timestamp
    BEFORE UPDATE ON transaction_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Audit log trigger
CREATE OR REPLACE FUNCTION log_transaction_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (operator_id, entity_type, entity_id, action, changes)
        VALUES (NEW.operator_id, 'transaction', NEW.id, 'create', to_jsonb(NEW));
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (operator_id, entity_type, entity_id, action, changes)
        VALUES (NEW.operator_id, 'transaction', NEW.id, 'update', jsonb_build_object(
            'old', to_jsonb(OLD),
            'new', to_jsonb(NEW)
        ));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_transactions
    AFTER INSERT OR UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION log_transaction_changes();

-- =============================================================================
-- DEFAULT DATA: Auto-initialize wallets + rules for new operators
-- =============================================================================
CREATE OR REPLACE FUNCTION initialize_operator_defaults()
RETURNS TRIGGER AS $$
BEGIN
    -- Create default wallets
    INSERT INTO wallets (operator_id, wallet_type, wallet_name, balance) VALUES
        (NEW.id, 'platform', 'GCash', 0),
        (NEW.id, 'platform', 'MariBank', 0),
        (NEW.id, 'cash', 'Cash', 0);

    -- 🔴 WRONG — RETAINED AS THE RECORD OF THE BUG.
    --
    -- The comments and the Cash In / Cash Out rows below are INVERTED. A Cash In is
    -- the customer handing over CASH and receiving e-money: the drawer goes UP and the
    -- platform wallet goes DOWN. This block says the opposite, and so do
    -- src/app/onboarding/page.tsx:245 and src/app/settings/rules/page.tsx.
    --
    -- The live DB rules and the OCR prompt have it right; the repo seed does not, so any
    -- operator onboarded with current repo code gets backwards rules (AUDITS #5a, #6).
    --
    -- Four of the six rows are wrong in a second way: the deltas do not sum to the fee
    -- earned. On a PHP 100 transaction, Telco Load comes to -95, Bills Payment -95,
    -- Bank Transfer -100, and Profit Remittance records a cash-IN. Nothing detected this
    -- because nothing asserted that the books must balance.
    --
    -- Correct directions are in PRD.md §3.3 and supabase/functions/_core/postings.ts.
    -- This whole function is dropped and replaced by gocash.provision_operator(), which
    -- seeds fee_rules instead: direction is fixed per type, only rate and minimum are
    -- operator-configurable.
    INSERT INTO transaction_rules (
        operator_id, transaction_type, platform,
        delta_platform_mult, delta_cash_amount_mult, delta_cash_mult
    ) VALUES
        (NEW.id, 'Cash In',           'all', 1,  -1, 1),   -- WRONG: should be -1, +1
        (NEW.id, 'Cash Out',          'all', -1,  1, 1),   -- WRONG: should be +1, -1
        (NEW.id, 'Telco Load',        'all', -1,  0, 1),   -- WRONG: loses the principal
        (NEW.id, 'Bills Payment',     'all', -1,  0, 1),   -- WRONG: loses the principal
        (NEW.id, 'Bank Transfer',     'all', -1,  0, 0),   -- WRONG: loses principal AND fee
        (NEW.id, 'Profit Remittance', 'all', -1,  1, 0);   -- WRONG: records a cash-in

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER init_operator_defaults
    AFTER INSERT ON operators
    FOR EACH ROW EXECUTE FUNCTION initialize_operator_defaults();
```

---

## 5. API Specifications

### 5.1 Supabase Auto-Generated REST API

Supabase generates REST endpoints for all tables, filtered by RLS:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/rest/v1/transactions` | GET | List own transactions |
| `/rest/v1/transactions?status=eq.awaiting_confirm` | GET | Pending confirmations |
| `/rest/v1/transactions?id=eq.{id}` | PATCH | Update transaction |
| `/rest/v1/wallets` | GET | Get wallet balances |
| `/rest/v1/transaction_rules` | GET | Get own profit rules |

### 5.2 Edge Functions

#### `process-transaction`
Full Phase 1 pipeline — receives image, runs all AI + business logic, writes to DB. Called directly from the PWA after image upload.

```typescript
// POST /functions/v1/process-transaction
// Auth: operator JWT (RLS enforced via service role writes)

interface ProcessTransactionRequest {
  image_base64: string;  // base64-encoded screenshot
}

interface ProcessTransactionResponse {
  transaction_id: string;
  status: 'awaiting_confirm';   // corrected: matches the live CHECK constraint
  // Pre-filled data for the review screen:
  platform: 'GCash' | 'MariBank' | 'Unknown' | string;
  transaction_type: 'Cash In' | 'Cash Out' | 'Telco Load' | 'Unknown' | string;
  amount: number;
  net_profit: number;
  account_number: string | null;
  reference_number: string | null;
  transaction_date: string | null;  // ISO UTC
}

// Internal flow:
// 1. Verify auth token → get operator_id
// 2. Decode base64 → upload to Supabase Storage
//    Path: transaction-images/{operator_id}/{timestamp}.jpg
// 3. Create transaction record: { operator_id, status: 'processing', image_url }
// 4. Call OpenAI GPT-4O (vision) with image → raw OCR text string
// 5. detectPlatform(ocrText) → platform
// 6. detectType(ocrText, platform) → transaction_type
// 7. calculateProfit(transaction_type, amount) → net_profit
//    (amount extracted from ocrText first — hard stop if not found or ≤ 0)
// 8. extractAccountNumber(ocrText) → account_number | null
// 9. Call OpenAI gpt-4.1-mini → { date, reference_number }
//    (hard stop if date cannot be parsed)
// 10. Upsert transaction record with all extracted fields
//     Dedup key: UNIQUE(operator_id, reference_number)
//     Status → 'awaiting_confirm'   [corrected spelling]
//     NO ledger entry is written here and NO balance moves.
// 11. Return ProcessTransactionResponse
```

> 🔴 **Step 10 is TARGET.** The live function writes `status: "confirmed"` and applies the
> balance change here. Also note: the image should upload *after* extraction succeeds, not
> before (step 2) — uploading first is one of the three bugs that leaves orphaned receipts.

#### `confirm-transaction`
Called when operator taps "Save Transaction" on the review screen. Replaces the old Telegram confirmation gate.

```typescript
// POST /functions/v1/confirm-transaction
interface ConfirmTransactionRequest {
  transaction_id: string;
  idempotency_key: string;   // required: a double-tap must not post twice
  // Optionally edited fields:
  transaction_type?: string;
  amount?: number;
  net_profit?: number;
  account_number?: string;
  platform?: string;
}

interface ConfirmTransactionResponse {
  success: boolean;
  transaction_id: string;
  wallet_balances: {
    platform: { name: string; balance: number };
    cash: { name: string; balance: number };
  };
}

// Flow (TARGET):
// 1. Verify auth + ownership of transaction_id; require status = 'awaiting_confirm'
// 2. Determine if any fields were edited (compare to current DB values)
// 3. Update transaction with confirmed values + set status='confirmed' or 'edited'
//    (nothing is in the ledger yet, so a pre-confirm edit needs no reversal)
// 4. Resolve the effective fee_rules row for (type, platform, transaction_date)
// 5. Build the balanced postings for the type (see _core/postings.ts)
// 6. Insert ONE ledger_entries row + its postings in one transaction.
//    The zero-sum trigger rejects the entry if the legs do not sum to zero.
//    A replayed idempotency_key is rejected -- one entry, not two.
// 7. Snapshot the resolved rate on the entry, so "why was this PHP 7?" is answerable
// 8. Return balances read back from account_balances
```

> 🔴 **Steps 4–8 are TARGET.** The live endpoint requires status `confirmed`/`edited`
> (it is an *edit* endpoint) and calls the 18-argument `confirm_transaction_atomic`, a
> hand-rolled reversal engine. That function also has **no status guard** in its
> transaction UPDATE, so two concurrent confirms both apply deltas (AUDITS #5 finding 3).
>
> One more live bug this flow must not inherit: `edits.account_number ?? tx.account_number`
> means a client sending `null` to *clear* a field silently keeps the old value. Applies to
> `account_number`, `reference_number` and `transaction_date`.

### 5.3 ~~Realtime Subscriptions (PWA)~~ — **REMOVED**

**This section described code that was never written.** Two `supabase.channel(...)`
subscriptions were specified here and reproduced as a core dependency across `README.md`,
`project-spec.md`, `architecture.md` and `CLAUDE.md`. A `grep` for `.channel(` and
`.subscribe()` across `src/` returns **zero call sites**. Realtime has never been used.

It is dropped from the new stack (~123 MiB of RAM for a feature nothing calls). Balances
and transaction status are read on navigation:

```typescript
// Dashboard: read derived balances on mount / navigation
const { data: balances } = await supabase
  .from('account_balances')
  .select('account_id, kind, platform, natural_balance')
  .eq('operator_id', operatorId);
```

PRD **FR-13** promised "instant" balance updates. That requirement is **changed, not
deleted**: it becomes refresh-on-navigate, which is what operators have actually been
getting for six months.

---

## 6. Business Logic Reference

All business logic lives in `supabase/functions/_core/` — pure TypeScript, Deno-compatible,
zero runtime dependencies, imported directly by the Edge Functions and by Next.js through a
tsconfig path alias, and unit-tested with Vitest.

> **Corrected location.** This said `lib/transaction-processing.ts`. That file was a
> copy-paste of the deployed logic that then diverged from it: the deployed copy gained
> `resolveRule()` (exact platform beats `"all"`) and Maya detection; the client copy kept
> first-match-wins and had neither. All 37 tests imported the client copy, so **every
> passing test exercised code that never ran in production** (AUDITS #5 finding 4). One
> source now, two runtimes.

### 6.1 Platform Detection

```typescript
// Keyword tables come from data, not literals: platform_catalog (global) +
// operator_platforms.keywords (per tenant). The operator's own mobile numbers are
// interpolated per request from gocash.operator_numbers -- see the note in §6.2.

function detectPlatform(ocrText: string, catalog): Platform {
  // GCash / MariBank / Maya / Unknown
}
```

> The `Unknown → "GCash"` fallback is **dropped**. `Unknown` means the gate asks the
> operator. Silently guessing a platform in a multi-tenant product posts to the wrong
> account.

### 6.2 Transaction Type Detection

```typescript
function detectType(ocrText: string, operatorNumbers: string[]): TransactionType {
  // "send money" / "you sent" / "sent to"  -> Cash In
  // "you received"                          -> Cash Out
  // "buy load" / "load completed" / "telco promo" / "product name" -> Telco Load
  // otherwise                               -> Unknown
}
```

> 🔴 **Two corrections to what was here.**
>
> 1. **An operator's personal account number was hardcoded in shipped classification
>    logic** — a `seabank: <number>` literal here, plus two more in §6.1 and four in the
>    §6.4 blacklist. Those literals are removed from this document. They still exist in
>    the OCR prompt and shared logic; Phase 2 of
>    the plan moves them to `gocash.operator_numbers`, loaded per request, with the exit
>    criterion being **zero hardcoded references anywhere in the codebase**. A keyword
>    table that names one tenant cannot serve a second one.
>
> 2. **The Cash In / Cash Out keyword mappings were swapped** between the repo copy and
>    the live copy (AUDITS #5a, finding 7). The live mapping shown above is the correct
>    one; the 37 repo tests asserted the repo's inverted mapping.

### 6.3 Fee Calculation — **CORRECTED**

**One formula for all six types**, resolved from `fee_rules` rather than hardcoded per type:

```
fee = ceil(max(amount × 2%, ₱5))          // rate_bps = 200, minimum_minor = 500
```

`supabase/functions/_core/fees.ts`, in integer centavos:

```typescript
export function calculateFee(
  txType: string, platform: string, amountMinor: Minor, rules: readonly FeeRule[]
): Minor {
  const rule = resolveFeeRule(txType, platform, rules);   // exact platform beats "all"
  if (!rule) return 0;                                    // unpriced earns nothing, no guessing

  const rate = rule.rate_bps / 10_000;
  let feeMinor = rate > 0 ? amountMinor * rate : 0;

  // Cash Out: the receipt may already include the fee. If the amount divides
  // cleanly back to a whole-peso base above PHP 250, take the fee from that base
  // so it is not charged twice.
  if (txType === 'Cash Out' && rate > 0) {
    const base = grossBasePesos(amountMinor / MINOR_PER_UNIT, rate);
    if (base !== null) feeMinor = base * rate * MINOR_PER_UNIT;
  }

  // NUANCE: the ceiling is applied to Cash In and Cash Out ONLY.
  if (txType === 'Cash In' || txType === 'Cash Out') {
    return ceilToUnit(Math.max(feeMinor, rule.minimum_minor));
  }
  // The other four types keep centavo precision. A deliberate deviation from the
  // decision as stated, preserving live behaviour.
  if (rule.minimum_minor) feeMinor = Math.max(feeMinor, rule.minimum_minor);
  return Math.round(feeMinor);
}
```

> 🔴 **What was here was fiction.** Three different per-type formulas, including a Telco
> Load "round up to the next ₱5" bracket ladder. No deployed code has ever done that.
>
> Fee rules are **effective-dated** (`effective_from`/`effective_to`, with a GiST exclusion
> constraint rejecting overlapping periods). Because a confirmed entry can be reversed and
> re-posted, a fee change without a time axis would silently rewrite history when an old
> transaction is amended. The resolved rate is snapshotted on the entry.

### 6.4 Account Number Extraction

```typescript
// The blacklist is the operator's own numbers, loaded per request from
// gocash.operator_numbers. It is NOT a module-level literal -- the four numbers
// previously hardcoded here belong to one operator and are removed from this document.

function extractAccountNumber(ocrText: string, blacklist: Set<string>): string | null {
  const matches = ocrText.match(/(?:\+63|0)[\d\s\-]{9,12}/g) ?? [];
  for (const match of matches) {
    const normalized = match.replace(/[\s\-]/g, '').replace(/^\+63/, '0');
    if (!blacklist.has(normalized)) return normalized;
  }
  return null;
}
```

### 6.5 ~~Wallet Delta Calculation~~ → Posting Construction

**`computeDeltas` and the three `delta_*` multiplier columns are deleted.** Their values
were only ever −1/0/+1, they encoded *direction* as operator-configurable data, and four of
the six types were consequently wrong in production with nothing to detect it.

The replacement is `_core/postings.ts`: three posting shapes, six named functions for
readability, every entry summing to zero.

| Shape | Types | Legs |
|---|---|---|
| `customer_pays_cash` | Cash In, Telco Load, Bills Payment, Bank Transfer | Cash **+(amount + fee)**, Platform **−amount**, Revenue **−fee** |
| `customer_pays_emoney` | Cash Out | Platform **+amount**, Cash **−(amount − fee)**, Revenue **−fee** |
| `equity_draw` | Profit Remittance | Cash **−amount**, Equity **+amount** |

The Cash Out asymmetry — fee *deducted* rather than added on top — is real and comes from
the live rules. It was invisible while it lived in multiplier columns.

Amounts are integer centavos in TypeScript. Postgres NUMERIC is exact, but the old float +
`round2()` guard could disagree with it; since the fee model produces whole pesos this
costs nothing. `accounts.currency` is `CHAR(3) NOT NULL DEFAULT 'PHP'` and an entry is
constrained to a single currency — a mixed-currency entry that sums to zero would be a
catastrophic silent bug.

### 6.6 Error Handling Strategy

| Error | Behaviour |
|-------|-----------|
| Amount not found or ≤ 0 | Hard stop — transaction saved with `status: 'failed'`, `processing_errors` populated |
| Date cannot be parsed | Hard stop — same as above |
| Account number not found | Soft failure — `account_number: null`, processing continues |
| Platform unknown | Soft failure — operator selects on review screen |
| Type unknown | Soft failure — operator selects on review screen |
| Duplicate reference_number | Upsert — updates existing record, no duplicate |


## 7. App Store Distribution

### 7.1 Build & Release Pipeline

```
Next.js Source
      │
      ├──▶ next build --output=export  ──▶  /out  (static files)
      │
      ├──▶ npx cap sync                ──▶  Copies /out into iOS + Android projects
      │
      ├──▶ iOS: Xcode Archive          ──▶  Apple App Store (TestFlight → Production)
      │
      └──▶ Android: Gradle assembleRelease ─▶  Google Play Store (Internal → Production)
```

### 7.2 iOS Requirements (Apple App Store)

| Requirement | Details |
|-------------|---------|
| Apple Developer Account | $99/year |
| Minimum iOS version | iOS 15+ (covers 95%+ of devices) |
| Privacy permissions (Info.plist) | `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` |
| Push notifications | APNs certificate or APNs key (.p8) |
| App Store review | 1-3 day review; financial apps may require additional compliance disclosures |
| In-App Purchases (for selling) | Apple takes 15-30% of subscription revenue via IAP |

> ⚠️ **Revenue sharing**: If you sell subscriptions through the iOS App Store, Apple takes 30% (15% after year 1). Consider offering web-only subscriptions at a lower price as an alternative.

### 7.3 Android Requirements (Google Play Store)

| Requirement | Details |
|-------------|---------|
| Google Play Developer Account | $25 one-time |
| Minimum Android version | Android 7+ (API 24, covers 95%+ of devices) |
| Permissions (AndroidManifest.xml) | `CAMERA`, `INTERNET`, `POST_NOTIFICATIONS` |
| Push notifications | Firebase Cloud Messaging (FCM) — free |
| Play Store review | 1-7 days for new apps; subsequent updates faster |
| In-App Purchases (for selling) | Google takes 15-30% |

### 7.4 Capacitor Build Commands

```bash
# Install Capacitor
npm install @capacitor/core @capacitor/cli
npm install @capacitor/ios @capacitor/android
npm install @capacitor/camera @capacitor/push-notifications @capacitor/haptics

# Initialize (one-time)
npx cap init "GoCash Tracker" "com.gocash.tracker" --web-dir=out

# Add platforms (one-time)
npx cap add ios
npx cap add android

# Build & sync (every release)
npm run build        # next build --output=export
npx cap sync         # copies web assets + updates native plugins

# Open in native IDE
npx cap open ios     # Opens Xcode
npx cap open android # Opens Android Studio
```

### 7.5 Device Tokens Table (for push notifications) — **NOT BUILT**

> 🔴 **`operator_devices` has never existed** in any GoCash database. It was proposed here,
> then listed in `architecture.md` as if it were part of the live schema for six months.
> Push notifications remain unbuilt. The DDL below is a proposal, not a record.

```sql
-- PROPOSED (never applied): track per-device push tokens per operator
CREATE TABLE operator_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_token UNIQUE (token)
);

CREATE INDEX idx_devices_operator ON operator_devices(operator_id);
```

---

## 9. SaaS Migration Strategy — **SUPERSEDED**

> 🔴 **This entire section is historical.** It plans a migration *from* n8n Data Tables
> *to* Supabase that completed in March 2026, and its "Keep — no change" row for the n8n AI
> pipeline is the opposite of what happened: n8n was removed from the pipeline entirely.
> Phase 0 and Phase 1 below both describe states the project passed through and left.
>
> **The current plan is `~/.claude/plans/i-think-the-whole-async-sparrow.md`:**
>
> | Phase | Work | Status |
> |---|---|---|
> | 0 | Close the anon RPC hole, lock CORS, capture production into the repo, stand up the dedicated 5-service stack | In progress (4 commits on `feature/ledger-rebuild`) |
> | 1 | The ledger and the gate; golden receipt set for OCR accuracy | In progress |
> | 2 | Tenant safety — nothing hardcoded to one operator; receipt retention; `ai_usage` metering | Next |
> | 4 | Durability — fix the offsite backup, verify a restore. **Hard gate before Phase 3** | Not started |
> | 3 | Self-serve signup + billing (**PayMongo**, not Stripe — it is PH-local and supports GCash/Maya) | Deferred until someone asks to pay |
>
> Retained below for the record.

### 7.1 What Changes vs. What Stays

| Component | Current | SaaS Target | Change |
|-----------|---------|-------------|--------|
| AI Pipeline | n8n nodes | n8n nodes | **Keep — no change** |
| Image input | base64 via webhook | base64 via Edge Fn → n8n | Supabase layer added |
| DB storage | n8n Data Tables | Supabase PostgreSQL | **Migrate** |
| Confirmation | Telegram sendAndWait | In-app confirm screen | **Replace** |
| Wallet update | n8n Data Table nodes | Supabase Edge Fn | **Replace** |
| Error notifications | Telegram (hardcoded) | Supabase + optional Telegram | **Update** |
| Auth | None (single user) | Supabase Auth | **Add** |
| Multi-tenancy | None | RLS on all tables | **Add** |

### 7.2 Phased Rollout

**Phase 0 (Current)**: Single operator, Telegram only
- No changes needed — system works today

**Phase 1 (MVP Frontend)**: Add PWA, keep n8n + Telegram confirm
- Build Next.js PWA with login, dashboard, transaction list
- PWA uploads screenshots → existing n8n webhook
- Telegram still handles confirmation
- PWA reads from n8n Data Tables via n8n API (or duplicate-write to Supabase)

**Phase 2 (Full SaaS)**: Migrate to Supabase, replace Telegram confirm
- Migrate n8n Data Tables → Supabase tables
- Add `operator_id` field to n8n writes
- Build `confirm-transaction` Edge Function
- Replace Telegram sendAndWait with PWA confirm screen
- Add per-operator Telegram notification settings (optional notify, not confirmation)

**Phase 3 (Scale)**: Multi-operator, billing, analytics
- Stripe billing integration
- Per-operator configurable profit rules
- Analytics dashboard
- Batch processing

### 7.3 Known Migration Risks

| Risk | Mitigation |
|------|------------|
| n8n writes to Data Tables must be redirected to Supabase | Update all Data Table nodes to HTTP Request nodes calling Supabase REST API |
| `starting_cash` naming confusion at migration | Rename to `cash_balance_before` in Supabase schema |
| "Cash out" vs "Cash Out" case mismatch | Fix in Telegram form before migration; normalize in code |
| Incomplete transactions (no confirmation) accumulate | Add background job to alert operators of `awaiting_confirm` > 24hr |
| Wallet balance drift if confirmation partially fails | Wrap wallet update + snapshot in a Postgres transaction function |

---

## 8. Wallet Balance Update — Postgres Function — **SUPERSEDED**

> 🔴 **This function is being dropped, and the shipped descendant of it was the problem.**
>
> The design below was implemented, then grew to **18 arguments** as it gained reversal
> support for edit-after-confirm. It became a hand-rolled reversal engine — and its
> expense is the most likely reason the confirmation gate was bypassed in the first place.
>
> Three concrete defects in the live descendant:
> - **No status guard** in its transaction `UPDATE`, so two concurrent confirms both apply
>   deltas (double-tap, retry on slow network).
> - **`SECURITY DEFINER` with `EXECUTE` granted to `PUBLIC`**, no `auth.uid()` check, and
>   `p_operator_id` as a caller-supplied parameter — callable with the public anon key and
>   no session.
> - The repo's `confirm-transaction` calls it with argument names it no longer has, so that
>   call returns PGRST202 against the live database.
>
> **Replacement:** confirming becomes "insert one balanced entry with an idempotency key".
> Atomicity comes from a single INSERT plus the `DEFERRABLE INITIALLY DEFERRED` zero-sum
> trigger, not from a procedure that reimplements arithmetic. Balances are derived from
> `account_balances`, so there is no second copy of the number to keep in step.
>
> Retained below for the record.

To prevent partial wallet updates (platform updated, cash not), wrap the confirmation in a database function:

```sql
CREATE OR REPLACE FUNCTION confirm_transaction(
    p_transaction_id UUID,
    p_operator_id UUID,
    p_transaction_type TEXT,
    p_amount DECIMAL,
    p_net_profit DECIMAL,
    p_account_number TEXT,
    p_platform TEXT,
    p_was_edited BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER  -- runs as function owner (bypasses RLS for atomicity)
AS $$
DECLARE
    v_rule transaction_rules%ROWTYPE;
    v_platform_wallet wallets%ROWTYPE;
    v_cash_wallet wallets%ROWTYPE;
    v_delta_platform DECIMAL;
    v_delta_cash DECIMAL;
    v_result JSONB;
BEGIN
    -- Verify ownership
    IF NOT EXISTS (
        SELECT 1 FROM transactions
        WHERE id = p_transaction_id AND operator_id = p_operator_id
          AND status = 'awaiting_confirm'
    ) THEN
        RAISE EXCEPTION 'Transaction not found or not awaiting confirmation';
    END IF;

    -- Get rule
    SELECT * INTO v_rule FROM transaction_rules
    WHERE operator_id = p_operator_id
      AND transaction_type = p_transaction_type
      AND (platform = p_platform OR platform = 'all')
    ORDER BY CASE WHEN platform = p_platform THEN 0 ELSE 1 END
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No transaction rule found for type: %', p_transaction_type;
    END IF;

    -- Compute deltas
    v_delta_platform := p_amount * v_rule.delta_platform_mult;
    v_delta_cash := (p_amount * v_rule.delta_cash_amount_mult)
                  + (p_net_profit * v_rule.delta_cash_mult);

    -- Update platform wallet
    UPDATE wallets SET
        balance = balance + v_delta_platform,
        last_transaction_id = p_transaction_id
    WHERE operator_id = p_operator_id AND wallet_name = p_platform
    RETURNING * INTO v_platform_wallet;

    -- Read cash balance BEFORE update (starting_cash snapshot)
    SELECT * INTO v_cash_wallet FROM wallets
    WHERE operator_id = p_operator_id AND wallet_name = 'Cash';

    -- Update cash wallet
    UPDATE wallets SET
        balance = balance + v_delta_cash,
        last_transaction_id = p_transaction_id
    WHERE operator_id = p_operator_id AND wallet_name = 'Cash';

    -- Update transaction with all confirmed values + wallet snapshots
    UPDATE transactions SET
        transaction_type = p_transaction_type,
        amount = p_amount,
        net_profit = p_net_profit,
        account_number = p_account_number,
        platform = p_platform,
        status = CASE WHEN p_was_edited THEN 'edited' ELSE 'confirmed' END,
        was_edited = p_was_edited,
        starting_cash = v_cash_wallet.balance,        -- before cash update
        wallet_balance = v_platform_wallet.balance,   -- after platform update
        confirmed_at = NOW(),
        confirmed_by = 'operator'
    WHERE id = p_transaction_id;

    -- Return updated balances for PWA
    SELECT jsonb_build_object(
        'platform_wallet', jsonb_build_object(
            'name', p_platform,
            'balance', v_platform_wallet.balance
        ),
        'cash_wallet', jsonb_build_object(
            'name', 'Cash',
            'balance', v_cash_wallet.balance + v_delta_cash
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;
```

> Using a single `SECURITY DEFINER` function ensures the wallet update + transaction snapshot is **atomic** — either all updates succeed or none do. This eliminates the partial-update risk present in the current sequential n8n flow.

---

## 10. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-22 | Claude | Initial technical specification |
| 2.0 | 2026-03-20 | Claude | Full accuracy audit; corrected two-phase write model, confirmation gate behavior (wallets only update after confirm), added transaction status lifecycle, fixed RLS INSERT policy gap on operators, renamed wallet_balance field context, added Postgres atomic confirm function, n8n node-by-node phase analysis, SaaS migration strategy and risks |
| 2.1 | 2026-03-20 | Claude | Added iOS + Android distribution via Capacitor; replaced PWA-only with cross-platform architecture; added App Store requirements, Capacitor config, native camera/push code samples, device tokens table, build pipeline |
| 3.0 | 2026-03-22 | Claude | Full Edge Function spec; n8n removed from the AI pipeline |
| 3.1 | 2026-09-23 | Claude | **Accuracy correction after Audits #5/#5a.** Added the status banner. Corrected §1.2 (described the n8n era as current). Marked the confirmation gate as target state throughout — it does not exist; `_process_transaction.ts` confirms and moves balances in one request. Replaced the three fictional per-type profit formulas (§3.3, §6.3) with the single `ceil(max(amount × 2%, ₱5))` rule, including the accurate Cash In/Cash Out-only ceiling nuance. Flagged the inverted Cash In/Cash Out seed rules in §4.2 and the four types whose deltas do not balance. Removed §5.3 Realtime (never used, zero call sites) and struck it from §2.1/§3.1/§3.2. Normalised `awaiting_confirmation` → `awaiting_confirm`. Removed an operator's hardcoded account numbers from §6.2/§6.4 and the §3.3 blacklist. Replaced §6.5 `computeDeltas` with the three posting shapes. Marked §7.5 `operator_devices` as never built, and §8/§9 as superseded. Documented the missing RLS `WITH CHECK` and the anon-EXECUTE hole in §4.2 |
