# GoCash Transaction Tracker — Product Requirements Document

## Document Information

| Field | Value |
|-------|-------|
| Product Name | GoCash Transaction Tracker |
| Version | 4.0 |
| Status | Active |
| Last Updated | 2026-03-21 |
| Previous Version | 3.0 (n8n workflow spec — superseded) |

---

## 1. Executive Summary

GoCash Transaction Tracker is a **fully standalone mobile app** (iOS + Android + PWA) for GoCash operators. Operators upload payment screenshots, the app uses AI to read and extract transaction data, the operator reviews and saves — and wallet balances update automatically.

No external workflow engine. No Telegram required. The app is the product.

### What It Replaces

The previous system was an n8n automation workflow where operators forwarded screenshots to a Telegram bot, confirmed via a Telegram form, and the workflow updated a database. That system is fully replaced by this app.

### Key Value Propositions

- **Automated Data Entry** — AI reads your GCash/MariBank screenshots so you never type transaction details manually
- **Instant Profit Calculation** — Your earnings are calculated automatically based on transaction type the moment you upload
- **Human-in-the-Loop Confirmation** — You review every transaction before your wallet balances are updated — this is intentional, not a limitation
- **Real-time Wallet Tracking** — Always know your exact GCash, MariBank, and Cash balances
- **Duplicate Prevention** — Uploading the same screenshot twice won't create duplicate records
- **Share-to-App Workflow** — Screenshot a GCash transaction and share it directly to this app — no switching between apps to find the photo

---

## 2. Problem Statement

### Current Challenges (Telegram-based workflow)

1. **Workflow dependency** — The old system required a running n8n homelab server and Telegram bot. Any downtime = no transaction tracking
2. **Fragile confirmation flow** — Transactions expired after 5 minutes if the Telegram form wasn't submitted; missed confirmations meant incorrect wallet balances
3. **Single operator only** — Hardcoded Telegram chat ID; no way to serve multiple operators
4. **No mobile-first UX** — The Telegram form was functional but not designed for fast mobile use in the field
5. **No platform management** — Wallets and rules were hardcoded in a database, not manageable by the operator

### Target Users

- **V1 Primary**: Single GoCash operator (you) managing daily transactions
- **V1+**: Other GoCash/MariBank operators — onboarded with zero backend changes (multi-tenant schema already live)
- **Secondary**: Business owners needing profit reporting across operators

---

## 3. Product Overview

### 3.1 How It Works

> ⚠️ **Critical Design Constraint — Two-Phase Write Model**: The transaction record is saved immediately after AI processing (Phase 1). Wallet balances are only updated **after** the operator explicitly reviews and saves the transaction in-app (Phase 2). This is intentional — it gives operators a chance to correct AI mistakes before money changes hands in the system.

#### Transaction Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PHASE 1 — AI PROCESSING                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Screenshot                                                                  │
│  (from camera, photo picker, or share sheet)                                 │
│       │                                                                      │
│       ▼                                                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌─────────────┐  │
│  │ Upload to    │──▶│ AI reads     │──▶│ Detect app   │──▶│ Calculate   │  │
│  │ Storage      │   │ screenshot   │   │ & type       │   │ earnings    │  │
│  │              │   │ (GPT-4O)     │   │ (code)       │   │ (code)      │  │
│  └──────────────┘   └──────────────┘   └──────────────┘   └─────────────┘  │
│                                                                    │         │
│                                                                    ▼         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌─────────────┐  │
│  │ Navigate to  │◀──│ Save to DB   │◀──│ Extract      │◀──│ Extract     │  │
│  │ Review screen│   │ (awaiting    │   │ date & ref # │   │ account #   │  │
│  │              │   │ confirmation)│   │ (gpt-4.1-m)  │   │ (code)      │  │
│  └──────────────┘   └──────────────┘   └──────────────┘   └─────────────┘  │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                    PHASE 2 — REVIEW & SAVE (Human Gate)                      │
│             (Wallet balances ONLY update when operator saves)                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Review Screen                                                        │    │
│  │ ┌───────────────────────────────────────────────────────────────┐   │    │
│  │ │ App Used:   GCash              Transaction: Cash In           │   │    │
│  │ │ Amount:     ₱500               Your Earnings: ₱10             │   │    │
│  │ │ Account:    09171234567        Transaction #: 891148103       │   │    │
│  │ │                                                               │   │    │
│  │ │              [Fix Details]          [Save Transaction →]      │   │    │
│  │ └───────────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                             │                                                │
│              ┌──────────────┴──────────────┐                                │
│              ▼                             ▼                                 │
│       [Saved / Fixed & Saved]      [Left app — transaction                  │
│              │                      stays in "To Review" queue,             │
│              │                      dashboard shows badge]                   │
│              ▼                                                               │
│  Look up Profit Settings → Compute wallet changes                            │
│       │                                                                      │
│       ├──▶ Update App Wallet (GCash or MariBank)                             │
│       └──▶ Update Cash Wallet                                                │
│                │                                                             │
│                ▼                                                             │
│       Save wallet snapshots to transaction:                                  │
│       cash_before = cash balance before this transaction                     │
│       wallet_after = app wallet balance after this transaction               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Supported Apps (Platforms)

| App | Detection Method |
|-----|-----------------|
| **GCash** | Keywords (case-insensitive): "Sent via GCash", "Transfer from 09757058698", "Buy Load", "to 09757058698" |
| **MariBank** | Keyword (case-sensitive): "MariBank" |
| **Unknown** | No matching keyword — operator selects manually on review screen |
| **Custom** | Operators can add their own apps/platforms via Platform Settings |

### 3.3 Transaction Types

| Type | Auto-Detected? | Earnings Formula | Notes |
|------|---------------|-----------------|-------|
| **Cash In** | ✅ Yes | `Math.ceil(Math.max(amount × 2%, ₱5))` | Min ₱5 |
| **Cash Out** | ✅ Yes | `Math.max(Math.ceil(earnings), ₱5)` where `earnings = raw_base × 2%` | Min ₱5; complex base calculation |
| **Telco Load** | ✅ Yes | `Math.max(truncated(amount × 2%), ₱5)` or rounded to next ₱5 | Min ₱5 |
| **Bills Payment** | ❌ Manual | Configurable via Profit Settings | |
| **Bank Transfer** | ❌ Manual | Configurable via Profit Settings | |
| **Profit Remittance** | ❌ Manual | None | Records a cash-out with no earnings |

### 3.4 AI Processing Pipeline

Two AI calls per transaction (server-side only — inside Supabase Edge Functions):

| Step | Model | Purpose |
|------|-------|---------|
| 1 | GPT-4O (Vision) | Read screenshot → extract all visible text |
| 2 | gpt-4.1-mini | Parse date + transaction number from extracted text |

Classification, profit calculation, and account number extraction are all code (not AI) — fast, deterministic, and free.

---

## 4. Functional Requirements

### 4.1 Input: Getting a Screenshot Into the App

#### FR-1: In-App Capture
- Tap "New Transaction" from the dashboard
- Opens camera (native) or photo picker (gallery)
- On web: standard file picker as fallback
- Supported image formats: JPG, PNG, HEIC (HEIC converted before upload)

#### FR-2: Share Sheet (Android P1, iOS P2)
- Operator takes a screenshot in GCash/MariBank app
- Taps "Share" → selects GoCash Tracker from the share sheet
- App opens directly to the processing screen with the shared image
- **Android**: intent filter for `ACTION_SEND` with image MIME types
- **iOS**: Share Extension (P2 — requires separate Xcode target)

### 4.2 AI Processing Pipeline

#### FR-3: Screenshot Upload
- Image uploaded to Supabase Storage (`transaction-images/{operator_id}/{timestamp}.jpg`)
- Transaction record created with `status: 'processing'`

#### FR-4: OCR — Text Extraction (GPT-4O)
- Extract all legible text from the screenshot
- Ignore ads, banners, promotional content
- Return absolute value of amounts (no negative signs)
- Return plain string — no formatting (downstream code handles parsing)

#### FR-5: Platform and Type Detection
- Auto-detect platform (GCash, MariBank, or Unknown) via keyword matching
- Auto-classify transaction type via keyword matching
- Unknown = operator selects manually on the review screen
- Classification is code-based (not AI) for reliability and zero cost

#### FR-6: Earnings Calculation Engine

```javascript
// Cash In
profit = Math.ceil(Math.max(amount * 0.02, 5));

// Cash Out
raw_base = amount / 1.02;
earnings = (Number.isInteger(raw_base) && raw_base > 250)
  ? raw_base * 0.02        // exact division case
  : amount * 0.02;         // standard case
profit = Math.max(Math.ceil(earnings), 5);

// Telco Load
if (amount % 5 === 0) {
  profit = Math.max(Math.trunc(amount * 0.02 * 100) / 100, 5);
} else {
  pre_total = amount + 5;
  next_multiple = pre_total + ((pre_total % 5 === 0) ? 0 : 5 - (pre_total % 5));
  profit = Math.max(Math.trunc((next_multiple - amount) * 100) / 100, 5);
}
```

> Stops processing with an error if amount is missing or ≤ 0.

#### FR-7: Account Number Extraction
- Extract Philippine mobile numbers (0 or +63 prefix format)
- Normalise to 11-digit string
- Blacklist operator's own numbers: `09757058698`, `13246870917` (and +63 equivalents)
- Returns first non-blacklisted match; null if none found (does NOT stop processing)

#### FR-8: Date and Transaction Number Extraction (gpt-4.1-mini)
- Extract transaction date; convert to UTC ISO (Asia/Manila timezone assumed)
- Extract transaction reference number
- Stops processing with an error if date cannot be parsed

### 4.3 Review & Save (Human Confirmation Gate)

#### FR-9: Review Screen
Shown immediately after Phase 1 completes. Pre-filled with AI-extracted data:

| Field | Label in App | Pre-filled? | Editable? |
|-------|-------------|------------|---------|
| `transaction_type` | Transaction type | ✅ AI detected | ✅ Dropdown |
| `platform` | App used | ✅ AI detected | ✅ Dropdown (operator's configured apps) |
| `amount` | Amount | ✅ AI extracted | ✅ |
| `net_profit` | Your earnings | ✅ Calculated | ✅ (override) |
| `account_number` | Customer number | ✅ AI extracted | ✅ |
| `reference_number` | Transaction number | ✅ AI extracted | ✅ |
| `transaction_date` | Date | ✅ AI extracted | ✅ |

#### FR-10: Save Transaction
- Operator taps "Save Transaction" → Phase 2 runs
- System looks up Profit Settings (transaction rules) → computes wallet changes
- Updates platform wallet (GCash or MariBank) and Cash wallet
- Saves `cash_before` and `wallet_after` snapshots to the transaction record
- Transaction status → `confirmed` (no edits) or `edited` (fields changed)

#### FR-11: Fix Before Saving
- Operator can edit any field on the review screen before saving
- All changes recorded in `edit_history` JSONB array on the transaction record
- No timeout — operator can take as long as needed

#### FR-12: Incomplete Transactions (Left Before Saving)
- If operator leaves the app before saving, transaction stays in `awaiting_confirmation` status
- Dashboard shows a "To Review" badge with count
- Tapping the badge lists unreviewed transactions
- Operator can return and complete them at any time
- No auto-expiry; no silent failures

### 4.4 Dashboard

#### FR-13: Wallet Balances (Real-time)
- Live GCash, MariBank, and Cash balances via Supabase Realtime
- Any configured custom platforms also shown
- Balance cards update instantly when a transaction is saved

#### FR-14: "To Review" Badge
- Shows count of transactions in `awaiting_confirmation` status
- Tapping opens the queue of unreviewed transactions
- Badge disappears when all transactions are reviewed

#### FR-15: Today's Summary
- Today's transaction count, total amount processed, total earnings
- Quick-access list of today's recent transactions

### 4.5 Transaction History

#### FR-16: Transaction List
- Full history, newest first
- Filters: date range, transaction type, app used, status
- Search by amount, account number, transaction number

#### FR-17: Transaction Detail
- All fields, AI-extracted values, any edits made
- Shows wallet snapshot (cash before, wallet after) for confirmed transactions
- Image of the original screenshot

### 4.6 Wallet Management

#### FR-18: View Balances
- All wallets listed with current balance
- Last updated timestamp per wallet

#### FR-19: Set Opening Balance (Onboarding + Manual Adjustment)
- On first login: prompted to enter current real-world balances for each wallet
- Any time: manually correct a wallet balance if it drifts out of sync with reality
- Adjustment logged to audit trail with reason

#### FR-20: Add / Remove Custom Platforms
- Add a new app/platform (e.g. Maya, ShopeePay)
- Creates a corresponding wallet row automatically
- Custom platforms appear in the "App used" dropdown on the review screen and in detection as "Unknown" (manual selection required)
- Delete a platform: soft-delete; historical transactions retain their platform label

### 4.7 Profit Settings (Transaction Rules)

#### FR-21: View Rules
- Shows current delta multipliers per transaction type
- Plain-language explanation: "For every Cash In, your GCash balance goes up by the full amount, and your cash goes down by the full amount. You keep the earnings."

#### FR-22: Edit Rules
- Operator can edit `delta_platform_mult`, `delta_cash_amount_mult`, `delta_cash_mult` per type
- Changes take effect on the next saved transaction (no retroactive recalculation)
- Reset to defaults button

### 4.8 Notifications (Optional)

#### FR-23: Telegram Notifications (Opt-in)
- Operator enters their Telegram chat ID in Settings
- Opt-in toggle per notification type:
  - Transaction processed (Phase 1 complete, needs review)
  - Error reading screenshot
- The **confirmation gate is in-app only** — Telegram never triggers wallet updates

#### FR-24: Push Notifications (P1)
- APNs (iOS) + FCM (Android) via Capacitor
- Same notification types as Telegram

### 4.9 Error Handling

#### FR-25: Processing Errors (Hard Stop)
| Scenario | In-App Behaviour |
|----------|-----------------|
| Amount not found or ≤ 0 | Error screen: "We couldn't find an amount in this screenshot — try a clearer photo" |
| Date cannot be parsed | Error screen: "We couldn't read the date — try a clearer photo or add it manually" |
| Duplicate transaction number | Info screen: "This transaction was already saved" (links to existing record) |
| Upload or processing failure | Error screen with retry button; transaction saved with `status: 'failed'` |

#### FR-26: Soft Failures (Processing Continues)
| Scenario | Behaviour |
|----------|-----------|
| Account number not found | `account_number = null`, review screen shown with field blank |
| App is Unknown | Review screen shown; operator selects from their configured apps |
| Type is Unknown | Review screen shown; operator selects from dropdown |

---

## 5. Non-Functional Requirements

### 5.1 Performance

| Metric | Target | Notes |
|--------|--------|-------|
| Phase 1 end-to-end (upload to review screen) | < 30 seconds | Includes 2 AI calls |
| Phase 2 (save to wallet update) | < 5 seconds | DB operations only |
| GPT-4O OCR latency | < 15 seconds | OpenAI dependent |
| gpt-4.1-mini latency | < 5 seconds | Fast model |

### 5.2 Reliability

- Idempotent processing: uploading the same screenshot twice updates the existing record, no duplicate
- Processing errors saved to transaction record — no silent failures
- Wallet balance only ever changes in Phase 2 (after explicit operator confirmation)

### 5.3 Security

- OpenAI API key stored in Supabase Edge Function environment — never exposed to the client
- All data isolated per operator via Row Level Security (RLS)
- No PII in error messages or logs
- Operator blacklist numbers never recorded as customer account numbers

### 5.4 Accessibility & Language

- All UI text in plain, simple Filipino-business-friendly language
- No technical jargon in labels, buttons, or error messages
- Operators are non-technical — the app must be self-explanatory

### 5.5 Platform Support

| Platform | Distribution | Target |
|----------|-------------|--------|
| iOS | Apple App Store (via Capacitor) | P0 |
| Android | Google Play Store (via Capacitor) | P0 |
| Web (PWA) | Browser install | P0 |

---

## 6. Integration Points

### 6.1 External Services

| Service | Purpose | Notes |
|---------|---------|-------|
| Supabase | Auth, Database (gocash schema), Storage, Realtime, Edge Functions | Core backend |
| OpenAI GPT-4O | Screenshot OCR | Called from Edge Function only |
| OpenAI gpt-4.1-mini | Date + transaction number extraction | Called from Edge Function only |
| Telegram Bot API | Optional notifications (opt-in) | Never controls wallet updates |

### 6.2 Supabase Schema

All data lives in the `gocash` schema on a shared self-hosted Supabase instance:

| Table | Purpose |
|-------|---------|
| `gocash.operators` | Operator accounts (id = auth.uid()) |
| `gocash.transactions` | All transaction records (two-phase write) |
| `gocash.wallets` | Per-operator wallet balances |
| `gocash.transaction_rules` | Delta multipliers per transaction type |
| `gocash.audit_logs` | Immutable change log |

---

## 7. Data Flow Summary

### 7.1 Happy Path

```
1.  Operator opens app → taps "New Transaction" (or shares screenshot from GCash)
2.  Screenshot uploaded to Supabase Storage
3.  process-transaction Edge Function runs:
      a. GPT-4O reads screenshot → raw text
      b. Code detects platform (GCash/MariBank/Unknown) and type
      c. Code calculates earnings
      d. Code extracts account number (with blacklist check)
      e. gpt-4.1-mini extracts date + transaction number
      f. Transaction saved to DB (status: awaiting_confirmation)
4.  App navigates to Review screen pre-filled with AI data
5.  Operator reviews, optionally fixes fields, taps "Save Transaction"
6.  confirm-transaction Edge Function runs:
      a. Updates transaction with confirmed values
      b. Looks up Profit Settings → computes deltaPlatform + deltaCash
      c. Updates platform wallet balance
      d. Updates cash wallet balance
      e. Saves cash_before + wallet_after snapshots to transaction
      f. Status → confirmed or edited
7.  Dashboard updates in real time (Supabase Realtime)
```

### 7.2 Interrupted Path (Left Before Saving)

```
1–4. Same as happy path
5.   Operator leaves app before saving
6.   Transaction stays in DB with status: awaiting_confirmation
     starting_cash and wallet_after remain NULL
7.   Dashboard shows "To Review" badge
8.   Operator returns, reviews, saves → Phase 2 completes
```

---

## 8. Out of Scope (V1)

- Multi-operator admin panel
- Automated reporting / exports (CSV, PDF)
- iOS Share Extension (P2 — Android share intent is P1)
- Biometric lock screen
- Offline mode / queue (transactions require network for AI processing)
- Auto-confirmation (a human must always review before wallets update)
