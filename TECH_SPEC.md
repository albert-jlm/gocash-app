# GoCash Transaction Tracker - Technical Specification

## Document Information

| Field | Value |
|-------|-------|
| Product Name | GoCash Transaction Tracker |
| Document Type | Technical Specification |
| Version | 3.0 |
| Status | Active |
| Last Updated | 2026-03-22 |
| Related PRD | [PRD.md](./PRD.md) |

---

## 1. System Overview

### 1.1 Product Vision

Transform the GoCash Transaction Tracker from a single-operator n8n workflow into a **multi-tenant SaaS platform** serving multiple GoCash operators through a **cross-platform mobile application** available on the web, iOS App Store, and Google Play Store — built from a single Next.js + Capacitor codebase.

### 1.2 Current State

| Aspect | Current Implementation |
|--------|------------------------|
| Architecture | Single n8n workflow (ID: `1O6ul5VKOzqPwtOD`) |
| Tenancy | Single operator |
| Storage | 3 n8n Data Tables (GoCash Database, GoCash Tx Rules, GoCash Wallet) |
| Interface | Telegram sendAndWait form + webhook |
| Processing | Two-phase: synchronous (Phase 1) + async human confirmation gate (Phase 2) |
| AI Cost | 2 OpenAI calls per transaction (GPT-4O vision + gpt-4.1-mini) |
| Confirmation | Operator MUST click "Edit" in Telegram for wallet balances to update |

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
│   │  ┌───────────┐                                              │  │
│   │  │ Realtime  │  (Live wallet + transaction sync to PWA)     │  │
│   │  │(Live sync)│                                              │  │
│   │  └───────────┘                                              │  │
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
│  PWA     │◀───│    Supabase DB (Realtime)            │◀───┘
│(Confirm  │    │ Transaction saved → status:          │
│  Screen) │    │ 'awaiting_confirm'                   │
└────┬─────┘    └─────────────────────────────────────┘
     │
     │ Operator reviews, optionally edits, then taps Confirm
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ Supabase Edge Fn: confirm-transaction                            │
│ • Update transaction record with confirmed values               │
│ • Look up transaction rules → compute deltas                    │
│ • Update platform wallet balance                                │
│ • Update cash wallet balance                                    │
│ • Write wallet snapshots to transaction (starting_cash,         │
│   wallet_balance)                                               │
│ • Set status: 'confirmed'                                       │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Transaction Status Lifecycle

```
[uploaded] → [processing] → [awaiting_confirm] → [confirmed]
                                               ↘ [edited] (confirmed with changes)
                    ↘ [failed] (any Phase 1 error)
```

| Status | Meaning | Wallet Updated? |
|--------|---------|----------------|
| `uploaded` | Image received, processing not yet started | No |
| `processing` | n8n pipeline running | No |
| `awaiting_confirm` | AI done, transaction saved, waiting for operator | No |
| `confirmed` | Operator confirmed without changes | **Yes** |
| `edited` | Operator confirmed with edits | **Yes** |
| `failed` | Processing error | No |

> ⚠️ **Key architectural constraint**: Wallet balances are NEVER updated before status reaches `confirmed` or `edited`. Transactions stuck in `awaiting_confirm` represent incomplete records. The system must handle this gracefully — operators should be alerted about pending confirmations.

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
| Realtime | Supabase Realtime (built-in client) | — | |
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
| Image Upload | Supabase Storage → trigger n8n | P0 | ✅ | ✅ | ✅ |
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
| Confirm | `/confirm/[id]` | Review AI results, edit if needed, confirm | Edit fields, Confirm |
| Transactions | `/transactions` | Full history with filters | Filter, search |
| Transaction Detail | `/transactions/[id]` | View single transaction, re-confirm if pending | Edit, re-confirm |
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

> ⚠️ **Next.js Static Export Required**: Capacitor bundles the app as static files. Next.js must be configured with `output: 'export'` in `next.config.js`. This means **no Server-Side Rendering** — all data fetching must happen client-side (which is already the case since you're using Supabase client SDK + Realtime).

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

#### Push Notification Setup

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
| **Edge Functions** | Processing trigger + confirmation logic | Deno runtime |
| **Realtime** | Live balance + transaction status updates to PWA | Postgres CDC |

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

> Implementation note (2026-03-22): the current shipped code uses a single GPT-4o extraction call, private `transaction-images` storage paths in `transactions.image_url`, `awaiting_confirm` as the review status, `operator_platforms` for dynamic platform validation, and shared logic in `supabase/functions/_shared/transaction-processing.ts`.

#### Edge Functions

| Function | Trigger | Responsibility |
|----------|---------|---------------|
| `process-transaction` | Called by PWA after image selection/share | Full Phase 1: private image upload → GPT-4o extraction → classify → profit calc → DB insert/dedupe |
| `confirm-transaction` | Called by PWA when operator confirms | Full Phase 2: update transaction → compute wallet deltas → update wallets → write snapshots |

#### `process-transaction` Flow

```typescript
// supabase/functions/process-transaction/index.ts
// Receives: { transaction_id, image_base64 }
// Auth: operator JWT (RLS enforced)

1. Decode base64 and store the original screenshot in private Supabase Storage
2. Call OpenAI GPT-4o once for structured extraction
3. Apply shared business-logic fallbacks for platform/type/account number
4. Calculate profit using operator transaction rules
5. If `reference_number` already exists for the operator, return the existing record
6. Otherwise insert a draft transaction with `status = 'awaiting_confirm'`
7. Return { transaction_id, platform, type, amount, profit, account, reference }
```

#### Business Logic (ported from n8n Code nodes to TypeScript)

```typescript
// supabase/functions/_shared/transaction-processing.ts — shared logic used by Edge Functions

// Platform detection
function detectPlatform(ocrText: string): 'GCash' | 'MariBank' | 'Unknown' { ... }

// Transaction type detection
function detectType(ocrText: string, platform: string): TransactionType { ... }

// Profit calculation
function calculateProfit(type: TransactionType, amount: number): number {
  switch (type) {
    case 'Cash In':
      return Math.ceil(Math.max(amount * 0.02, 5));
    case 'Cash Out':
      const raw_base = amount / 1.02;
      const earnings = (Number.isInteger(raw_base) && raw_base > 250)
        ? raw_base * 0.02
        : amount * 0.02;
      return Math.max(Math.ceil(earnings), 5);
    case 'Telco Load':
      if (amount % 5 === 0) return Math.max(Math.trunc(amount * 0.02 * 100) / 100, 5);
      const pre_total = amount + 5;
      const next_multiple = pre_total + ((pre_total % 5 === 0) ? 0 : 5 - (pre_total % 5));
      return Math.max(Math.trunc((next_multiple - amount) * 100) / 100, 5);
    default:
      return 0;
  }
}

// Account number extraction (with operator blacklist)
const BLACKLIST = ['09757058698', '13246870917', '639757058698'];
function extractAccountNumber(ocrText: string): string | null { ... }
```

> The business logic lives in `supabase/functions/_shared/transaction-processing.ts` and is imported by the Edge Functions. It is unit-tested with Vitest.

---

## 4. Database Schema

> Implementation note (2026-03-22): the live schema now includes `gocash.operator_platforms`, `wallets.color`, `wallets.is_active`, a unique partial index on `(operator_id, reference_number)` for non-null references, and private storage paths in `transactions.image_url`. The SQL examples below are historical design scaffolding and should be read together with the migrations in `supabase/migrations/`.

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
-- Mirrors current n8n "GoCash Tx Rules" table (ID: 8WYdo1hXpavBttLN)
-- delta_platform_mult, delta_cash_amount_mult, delta_cash_mult
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

-- NOTE: Service role key (used by n8n + Edge Functions) bypasses RLS by default.
-- Never expose service_role key to the client. Use anon key in the PWA.

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

    -- Create default transaction rules (mirrored from current n8n Tx Rules table)
    -- Cash In: GCash/MariBank balance goes up, Cash goes down (customer gives cash, wallet gets credited)
    -- Cash Out: GCash/MariBank balance goes down, Cash goes up
    -- Telco Load: GCash balance goes down, Cash gets profit
    INSERT INTO transaction_rules (
        operator_id, transaction_type, platform,
        delta_platform_mult, delta_cash_amount_mult, delta_cash_mult
    ) VALUES
        (NEW.id, 'Cash In',           'all', 1,  -1, 1),
        (NEW.id, 'Cash Out',          'all', -1,  1, 1),
        (NEW.id, 'Telco Load',        'all', -1,  0, 1),
        (NEW.id, 'Bills Payment',     'all', -1,  0, 1),
        (NEW.id, 'Bank Transfer',     'all', -1,  0, 0),
        (NEW.id, 'Profit Remittance', 'all', -1,  1, 0);

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
  status: 'awaiting_confirm' | 'confirmed' | 'edited';
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
// 9. Return existing record immediately if a duplicate reference already exists
// 10. Insert transaction record with all extracted fields
//     Dedup guard: unique partial index on (operator_id, reference_number)
//     Status → 'awaiting_confirm'
// 11. Return ProcessTransactionResponse
```

#### `confirm-transaction`
Called when operator taps "Save Transaction" on the review screen. Replaces the old Telegram confirmation gate.

```typescript
// POST /functions/v1/confirm-transaction
interface ConfirmTransactionRequest {
  transaction_id: string;
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

// Flow:
// 1. Verify auth + ownership of transaction_id
// 2. Determine if any fields were edited (compare to current DB values)
// 3. Update transaction with confirmed values + set status='confirmed' or 'edited'
// 4. Look up transaction_rules by transaction_type
// 5. Compute: deltaPlatform = amount × delta_platform_mult
//             deltaCash = (amount × delta_cash_amount_mult) + (profit × delta_cash_mult)
// 6. Read current platform wallet balance
// 7. Update platform wallet: balance += deltaPlatform
// 8. Read current cash wallet balance (starting_cash snapshot = this value)
// 9. Update cash wallet: balance += deltaCash
// 10. Update transaction: starting_cash = pre-step-8 cash balance,
//                         wallet_balance = post-step-7 platform balance,
//                         confirmed_at = now(), confirmed_by = 'operator'
// 11. Log to audit_logs
// 12. Return updated wallet balances
```

### 5.3 Realtime Subscriptions (PWA)

```typescript
// Subscribe to transaction status changes for live updates
const subscription = supabase
  .channel('transaction-updates')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'gocash',
    table: 'transactions',
    filter: `operator_id=eq.${userId}`
  }, (payload) => {
    // Update local state when n8n writes results back
    // e.g., status changes from 'processing' → 'awaiting_confirm'
    updateTransaction(payload.new);
  })
  .subscribe();

// Subscribe to wallet balance changes
const walletSub = supabase
  .channel('wallet-updates')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'gocash',
    table: 'wallets',
    filter: `operator_id=eq.${userId}`
  }, (payload) => {
    updateWalletBalance(payload.new);
  })
  .subscribe();
```

---

## 6. Business Logic Reference

All business logic lives in `supabase/functions/_shared/transaction-processing.ts` — pure TypeScript, shared by the Edge Functions, and unit-testable with Vitest.

### 6.1 Platform Detection

```typescript
const GCASH_KEYWORDS = ['sent via gcash', 'transfer from 09757058698', 'buy load', 'to 09757058698'];

function detectPlatform(ocrText: string): 'GCash' | 'MariBank' | 'Unknown' {
  const lower = ocrText.toLowerCase();
  if (GCASH_KEYWORDS.some(k => lower.includes(k.toLowerCase()))) return 'GCash';
  if (ocrText.includes('MariBank')) return 'MariBank';  // case-sensitive
  return 'Unknown';
}
```

### 6.2 Transaction Type Detection

```typescript
function detectType(ocrText: string): TransactionType {
  const lower = ocrText.toLowerCase();
  if (lower.includes('sent via gcash') || lower.includes('transfer from 09757058698')
      || lower.includes('seabank: 13246870917'))         return 'Cash In';
  if (ocrText.includes('to 09757058698'))                return 'Cash Out';  // case-sensitive
  if (lower.includes('buy load') || lower.includes('load completed')
      || lower.includes('telco promo') || lower.includes('product name')) return 'Telco Load';
  return 'Unknown';
}
```

### 6.3 Profit Calculation

```typescript
function calculateProfit(type: TransactionType, amount: number): number {
  if (amount <= 0) throw new Error('Amount must be greater than 0');

  switch (type) {
    case 'Cash In':
      return Math.ceil(Math.max(amount * 0.02, 5));

    case 'Cash Out': {
      const raw_base = amount / 1.02;
      const earnings = (Number.isInteger(raw_base) && raw_base > 250)
        ? raw_base * 0.02
        : amount * 0.02;
      return Math.max(Math.ceil(earnings), 5);
    }

    case 'Telco Load':
      if (amount % 5 === 0) {
        return Math.max(Math.trunc(amount * 0.02 * 100) / 100, 5);
      } else {
        const pre_total = amount + 5;
        const next_multiple = pre_total + ((pre_total % 5 === 0) ? 0 : 5 - (pre_total % 5));
        return Math.max(Math.trunc((next_multiple - amount) * 100) / 100, 5);
      }

    default:
      return 0;  // Bills Payment, Bank Transfer, Profit Remittance, Unknown
  }
}
```

### 6.4 Account Number Extraction

```typescript
const BLACKLIST = new Set(['09757058698', '13246870917', '639757058698', '6313246870917']);

function extractAccountNumber(ocrText: string): string | null {
  const matches = ocrText.match(/(?:\+63|0)[\d\s\-]{9,12}/g) ?? [];
  for (const match of matches) {
    const normalized = match.replace(/[\s\-]/g, '').replace(/^\+63/, '0');
    if (!BLACKLIST.has(normalized)) return normalized;
  }
  return null;
}
```

### 6.5 Wallet Delta Calculation (used in confirm-transaction)

```typescript
function computeDeltas(rule: TransactionRule, amount: number, profit: number) {
  return {
    deltaPlatform: amount * rule.delta_platform_mult,
    deltaCash: (amount * rule.delta_cash_amount_mult) + (profit * rule.delta_cash_mult),
  };
}
```

### 6.6 Error Handling Strategy

| Error | Behaviour |
|-------|-----------|
| Amount not found or ≤ 0 | Hard stop — transaction saved with `status: 'failed'`, `processing_errors` populated |
| Date cannot be parsed | Hard stop — same as above |
| Account number not found | Soft failure — `account_number: null`, processing continues |
| Platform unknown | Soft failure — operator selects on review screen |
| Type unknown | Soft failure — operator selects on review screen |
| Duplicate reference_number | Return the existing transaction; do not apply wallet mutations twice |


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

### 7.5 Device Tokens Table (for push notifications)

```sql
-- Add to schema: track per-device push tokens per operator
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

## 9. SaaS Migration Strategy

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

## 8. Wallet Balance Update — Postgres Function (Recommended)

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
