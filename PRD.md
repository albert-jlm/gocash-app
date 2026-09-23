# GoCash Transaction Tracker — Product Requirements Document

## Document Information

| Field | Value |
|-------|-------|
| Product Name | GoCash Transaction Tracker |
| Version | 4.1 |
| Status | Active — under correction mid-rebuild |
| Last Updated | 2026-09-23 |
| Previous Version | 3.0 (n8n workflow spec — superseded) |

---

## Status as of 2026-09-23

**This PRD is ~6 months stale and in places was actively wrong. It is being corrected on
`feature/ledger-rebuild`.** Read alongside:

- `AUDITS.md` — Audit **#5** (full review) and **#5a** (live verification; corrects #5)
- `~/.claude/plans/i-think-the-whole-async-sparrow.md` — the approved rebuild plan

What this document got wrong, corrected inline below:

| Was | Now |
|---|---|
| Cash In moves the platform wallet **up** and cash **down** (FR-21, §3.1) | **Inverted.** Customer hands over cash → drawer **UP**, platform wallet **DOWN** |
| Three per-type earnings formulas incl. a PHP 5 Telco ladder (§3.3, FR-6) | One formula for all six types: `ceil(max(amount × 2%, PHP 5))` |
| "Single operator" target (§2), "multi-operator admin panel" out of scope (§8) | Multi-tenant SaaS is the target; only *billing* is deferred |
| Confirmation gate described as present-tense fact (§3.1, §5.2, §8) | **The gate does not exist today.** It is being restored |
| Real-time balances via Supabase Realtime (FR-13) | Realtime was never used; balances refresh on navigate |
| Status `awaiting_confirmation` | The live CHECK constraint is `awaiting_confirm` |
| "Auto-confirmation" out of scope (§8) | `auto_confirm_below_minor` ships, default **off** — see §8 |
| — | New: **FR-27 receipt retention** (PH Data Privacy Act) |

---

## 1. Executive Summary

GoCash Transaction Tracker is a **fully standalone mobile app** (iOS + Android + PWA) for GoCash operators. Operators upload payment screenshots, the app uses AI to read and extract transaction data, the operator reviews and saves — and wallet balances update automatically.

No external workflow engine. No Telegram required. The app is the product.

### What It Replaces

The previous system was an n8n automation workflow where operators forwarded screenshots to a Telegram bot, confirmed via a Telegram form, and the workflow updated a database. That system is fully replaced by this app.

### Key Value Propositions

- **Automated Data Entry** — AI reads your GCash/Maya/MariBank screenshots so you never type transaction details manually
- **Instant Profit Calculation** — Your earnings are calculated automatically the moment you upload
- **Human-in-the-Loop Confirmation** — You review every transaction before your balances are updated — this is intentional, not a limitation. *(Target state: this gate does not exist in the running system today and is being restored.)*
- **Wallet Tracking** — Always know your exact GCash, Maya, MariBank, and Cash balances. *(Balances refresh when you open or navigate the app, not via a live push — see FR-13.)*
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

**The product target is multi-tenant SaaS.** Earlier versions of this document described a
single-operator tool with multi-operator support as a later phase; that is no longer the
framing. Tenant-safe architecture (nothing hardcoded to one operator, config as data) is in
scope now. **Billing and self-serve signup are deferred until someone asks to pay** — see §8.

- **V1 Primary**: Philippine e-wallet agents managing daily GCash/Maya/MariBank transactions
- **First tenant**: the author's own operation, but with no first-class status in the schema
- **Secondary**: Business owners needing profit reporting across operators

> The blocker to a second tenant is not the schema — every table is already
> `operator_id`-scoped. It is that the OCR prompt is tuned against one operator's receipts
> and **has no accuracy measurement**. A golden receipt set (plan Phase 1.5) must produce an
> error bar before a seat is sold to operator #3.

---

## 3. Product Overview

### 3.1 How It Works

> ⚠️ **Critical Design Constraint — Two-Phase Write Model**: The transaction record is saved immediately after AI processing (Phase 1). Wallet balances are only updated **after** the operator explicitly reviews and saves the transaction in-app (Phase 2). This is intentional — it gives operators a chance to correct AI mistakes before money changes hands in the system.
>
> 🔴 **This is TARGET state, not current behaviour.** The live
> `supabase/functions/main/_process_transaction.ts` writes `status: "confirmed"` and applies
> the balance change in the same request as the OCR; `_confirm_transaction.ts` rejects any
> transaction that is not already confirmed and has become an *edit* endpoint. The flow
> diagram below describes the gate as it is being restored (plan Phase 1.2), not as it runs.
>
> **Why it comes back:** the unreliable part of this system is the OCR, not the ledger.
> GPT-4o reading PHP 1,850 as PHP 1,850,000 is a normal failure with no cheap detector.
> Under auto-confirm that misread becomes a posted entry, and in an append-only ledger the
> only remedy is a reversal that sits in the audit trail forever.

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
| **GCash** | Keywords (case-insensitive): "Sent via GCash", "Buy Load", plus transfers to/from the operator's own numbers |
| **MariBank** | Keyword (case-sensitive): "MariBank" |
| **Maya** | Keyword match (added after this section was first written) |
| **Unknown** | No matching keyword — operator selects manually on review screen |
| **Custom** | Operators can add their own apps/platforms via Platform Settings (`operator_platforms`) |

> The operator's own mobile numbers were previously written out in full in this table. They
> are deliberately omitted now: they are one operator's personal numbers in a document
> headed for a multi-tenant product. They are still hardcoded in the OCR prompt and shared
> logic; Phase 2 of the plan moves them to `gocash.operator_numbers`.

### 3.3 Transaction Types

**One fee formula for all six types:**

```
fee = ceil(max(amount × 2%, ₱5))
```

Expressed as data: `rate_bps = 200`, `minimum_minor = 500` in `fee_rules`.

> **Correction.** Earlier versions of this table gave three different per-type formulas,
> including a "round up to the next ₱5" Telco Load ladder. **None of that is real** — it
> was fiction in both this document and `TECH_SPEC.md`. There is no bracket ladder.
>
> **Implementation nuance (accurate as built):** `supabase/functions/_core/fees.ts` applies
> the ceiling to **Cash In and Cash Out only**; the other four types keep centavo precision
> (`Math.round`). This preserves live behaviour and is a known, deliberate deviation from
> the decision as stated above. Cash Out additionally carries a gross-amount heuristic: if
> the receipt amount divides cleanly back to a whole-peso base above ₱250, the fee is taken
> from that base rather than the printed total, so a fee already included in the receipt is
> not charged twice.

| Type | Auto-Detected? | Balance Effect | Notes |
|------|---------------|-----------------|-------|
| **Cash In** | ✅ Yes | Cash **+(amount + fee)**, platform **−amount**, revenue **−fee** | Customer hands over cash |
| **Cash Out** | ✅ Yes | Platform **+amount**, cash **−(amount − fee)**, revenue **−fee** | Fee is *deducted*, not added on top — this asymmetry with Cash In is real |
| **Telco Load** | ✅ Yes | Cash **+(amount + fee)**, platform **−amount**, revenue **−fee** | Was booked as −95 on a ₱100 load in production |
| **Bills Payment** | ❌ Manual | Same shape as Telco Load | Was booked as −95 in production |
| **Bank Transfer** | ❌ Manual | Same shape as Telco Load | Worst case live: full principal disappeared |
| **Profit Remittance** | ❌ Manual | Cash **−amount**, equity **+amount**. No fee | Owner takes cash out of the drawer. Was recorded as a cash-*in* in production |

Postings are signed integer centavos and **must sum to zero per entry**, enforced by a
`DEFERRABLE INITIALLY DEFERRED` trigger. Direction is **not operator-configurable** — that
is exactly what the old `delta_*` multiplier columns were, and it is why four of the six
types were destroying money in production.

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

One formula, all six types. Resolved from `fee_rules` (`rate_bps`, `minimum_minor`), not
hardcoded per type:

```javascript
// All types — amounts in integer centavos
fee = ceil(max(amount * 0.02, 5.00))
```

Two accurate caveats about the implementation in `supabase/functions/_core/fees.ts`:

```javascript
// 1. The ceiling is applied to Cash In and Cash Out only.
//    Telco Load, Bills Payment, Bank Transfer and Profit Remittance keep
//    centavo precision. Deliberate: preserves live behaviour.

// 2. Cash Out gross-amount heuristic — the receipt may already include the fee.
raw_base = amount / 1.02;
if (raw_base > 250 && isWholePeso(raw_base)) {
  fee = raw_base * 0.02;   // take the fee from the base, not the printed total
}
```

> **Correction.** The three separate per-type formulas that were here — including a Telco
> Load "round up to the next ₱5" ladder — never existed in any deployed code. They were
> invented in this document and mirrored into `TECH_SPEC.md` §3.3/§6.3.

> Stops processing with an error if amount is missing or ≤ 0.

> Fee rules are **effective-dated**. Because a confirmed entry can be reversed and
> re-posted, a fee change without a time axis would silently rewrite history when an old
> transaction is amended. The resolved rate is snapshotted on the entry so "why was this
> ₱7?" is answerable.

#### FR-7: Account Number Extraction
- Extract Philippine mobile numbers (0 or +63 prefix format)
- Normalise to 11-digit string
- Blacklist the operator's own numbers (and their +63 equivalents) so they are never
  recorded as a customer account number. *The two numbers were previously listed here in
  full; they are one operator's personal numbers and are deliberately omitted. They are
  hardcoded in the OCR prompt and shared logic today and move to `gocash.operator_numbers`
  in Phase 2 — the exit criterion is zero hardcoded references anywhere in the codebase.*
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
- System resolves the effective `fee_rules` row → builds the balanced postings for the type
- Inserts **one** `ledger_entries` row plus its `postings` atomically, guarded by an
  idempotency key so a double-tap cannot post twice
- Transaction status → `confirmed` (no edits) or `edited` (fields changed)
- **Void** is a reversal entry plus `status = 'voided'`; **amend** is a reversal plus a new
  entry, both retained. Ledger tables reject DELETE

> Wallet snapshot columns (`starting_cash`, `wallet_balance`) go away with the `wallets`
> table — balances become derived from `account_balances`, which also makes the running
> balance ("why is my GCash ₱8,240?") answerable for the first time.
>
> 🔴 **Not current.** Today this endpoint edits an already-confirmed transaction; balances
> moved back at step FR-3.

#### FR-11: Fix Before Saving
- Operator can edit any field on the review screen before saving
- All changes recorded in `edit_history` JSONB array on the transaction record
- No timeout — operator can take as long as needed

#### FR-12: Incomplete Transactions (Left Before Saving)
- If operator leaves the app before saving, transaction stays in `awaiting_confirm` status
  (this is the spelling in the live CHECK constraint; earlier drafts of this PRD said
  `awaiting_confirmation`, which no database has ever accepted)
- Dashboard shows a "To Review" badge with count
- Tapping the badge lists unreviewed transactions
- Operator can return and complete them at any time
- No auto-expiry; no silent failures

### 4.4 Dashboard

#### FR-13: Wallet Balances (**CHANGED** — refresh-on-navigate, not real-time)
- GCash, Maya, MariBank, and Cash balances read from the derived `account_balances` view
- Any configured custom platforms also shown
- Balance cards refresh when the dashboard is opened or navigated to, and after a save

> **Requirement changed, not dropped.** This originally promised *instant* updates via
> Supabase Realtime. Realtime has **never been used** in this app — `grep` for `.channel(`
> and `.subscribe()` across `src/` finds zero call sites — despite being documented as a
> core dependency in `README.md`, `project-spec.md`, `architecture.md`, `CLAUDE.md` and
> five places in `TECH_SPEC.md`. It is being dropped from the new stack (it costs ~123 MiB
> of RAM for a feature nothing calls). "Instant" therefore becomes "on next read", which is
> what operators have actually been getting for six months.

#### FR-14: "To Review" Badge
- Shows count of transactions in `awaiting_confirm` status
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

### 4.7 Profit Settings (Fee Rules)

#### FR-21: View Rules — **CORRECTED, and narrowed to fee-only**

🔴 **The previous text of this requirement was backwards.** It read: *"For every Cash In,
your GCash balance goes up by the full amount, and your cash goes down by the full amount."*
That is the inverse of what a Cash In is, and the same inversion appears in
`TECH_SPEC.md` §4.2, `src/app/settings/rules/page.tsx` and `src/app/onboarding/page.tsx` —
so any operator onboarded with current repo code gets backwards rules.

**Correct, operator-confirmed:**

> For every **Cash In**, the customer hands you **cash** and you send them e-money. Your
> cash drawer goes **up** by the amount plus your fee, your GCash balance goes **down** by
> the amount, and the fee is your earnings.

- Shows the current fee rate and minimum per transaction type, and the period each is
  effective for
- **Direction is no longer shown or editable** — see FR-22

#### FR-22: Edit Rules — **CHANGED: fee-only**
- Operator can edit the **rate** and **minimum** per transaction type. Changes are
  effective-dated; history is not retroactively recalculated
- Reset to defaults button

> **Requirement changed, not dropped.** This previously let the operator edit
> `delta_platform_mult`, `delta_cash_amount_mult` and `delta_cash_mult` — i.e. the
> *direction* money moves. Those three columns, whose values were only ever −1/0/+1, are
> the reason Telco Load booked −95 on a ₱100 load, Bank Transfer lost the full principal,
> and Profit Remittance recorded a cash-*in*. Nothing detected it because nothing asserted
> the books must balance.
>
> Direction is now fixed per type and enforced by the zero-sum posting trigger. What
> operators genuinely need configurable is *which platforms*, *what they charge*, and *what
> they call things* — not which way money flows.

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

### 4.10 Receipt Retention & Data Privacy

#### FR-27: Receipt Retention (**NEW**)

Receipt screenshots are **kept N days, then purged**. `N` is per-plan
(`plans.receipt_retention_days`).

- Void and amend enqueue the receipt into `receipt_deletion_queue` immediately
- A scheduled cleanup drains the queue and deletes expired objects from Storage
- The image is uploaded **after** extraction succeeds, not before, so a failed OCR does not
  leave an orphaned receipt
- A one-page retention and privacy policy must exist in the repo

> **Why this is a requirement and not housekeeping.** These images contain **customers'
> mobile numbers**, held on behalf of *other operators* once this is multi-tenant. That is
> a Philippine **Data Privacy Act** exposure, and no version of this PRD, the TECH_SPEC,
> `architecture.md` or `README.md` has ever mentioned retention, deletion, or privacy
> obligations at all.
>
> **Current state is worse than "unimplemented":** images upload *before* the AI call; the
> served `delete_transaction_atomic` passes NULL for bucket/path so nothing is ever
> enqueued; `cleanup-receipts` sits in a directory the edge runtime never loads, with its
> secret unset and no scheduler wired up. Five orphaned storage objects were found in the
> audit. Scheduling comes from the existing n8n instance — `pg_cron` is not installed and
> adding it means changing the Postgres image under a financial database.

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

- Idempotent processing: uploading the same screenshot twice updates the existing record, no
  duplicate. Enforced by `UNIQUE (operator_id, reference_number)`, which does exist live
- Processing errors saved to transaction record — no silent failures
- Balances only ever change in Phase 2, after explicit operator confirmation, and only by
  inserting a balanced ledger entry — **TARGET; today balances move during Phase 1**
- The books must balance: `unbalanced_entries` must always return zero rows

### 5.3 Security

- OpenAI API key stored in Supabase Edge Function environment — never exposed to the client
- All data isolated per operator via Row Level Security (RLS). Every UPDATE policy must
  carry a `WITH CHECK` — live, none do, so a client can move a row into another tenant
- No `gocash` function may be EXECUTE-able by `anon` or `authenticated`. Six
  `SECURITY DEFINER` functions were callable with the public anon key and no session
  (AUDITS #5a); CI asserts this generically so the next one added is caught
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
| Supabase | Auth, Database (gocash schema), Storage, Edge Functions | Core backend. Dedicated 5-service stack (`~/homelab/gocash/docker-compose.yml`), **not** the shared instance. Realtime not used |
| OpenAI GPT-4o | Screenshot OCR | Called from Edge Function only |
| OpenAI gpt-4.1-mini | Date + transaction number extraction | Called from Edge Function only |
| Telegram Bot API | Optional notifications (opt-in) | Never controls wallet updates |

### 6.2 Supabase Schema

All data lives in the `gocash` schema on a shared self-hosted Supabase instance:

| Table | Purpose | State |
|-------|---------|---|
| `gocash.operators` | Operator accounts | Live |
| `gocash.transactions` | All transaction records | Live |
| `gocash.operator_platforms` | Per-operator platform list | Live (undocumented until now) |
| `gocash.audit_logs` | Change log, written by the `audit_transactions` trigger | Live. **No trigger on wallets**, so manual balance overrides are unaudited |
| `gocash.receipt_deletion_queue` | Receipts pending purge | Live, but nothing enqueues into it |
| `gocash.wallets` | Per-operator wallet balances | **Being dropped** — two sources of truth for one number |
| `gocash.transaction_rules` | Delta multipliers per transaction type | **Being dropped** |
| `gocash.accounts` | cash / platform / revenue / equity, currency-tagged | New |
| `gocash.ledger_entries` | One per confirmed transaction; append-only | New |
| `gocash.postings` | Signed integer-centavo legs; must sum to zero | New |
| `gocash.account_balances` | View — derived balances | New |
| `gocash.fee_rules` | Effective-dated `rate_bps` + `minimum_minor` | New |

> The shared instance had **7 tables, 9 functions, 6 triggers and 18 indexes** live while
> the repo's migrations produced 5/2/0/0 — the schema had been built entirely by hand. The
> production schema was captured into `20260923000000_baseline_gocash.sql` on this branch
> so the repo is the source of truth again.

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
      f. Transaction saved to DB (status: awaiting_confirm) — NO ledger entry yet
4.  App navigates to Review screen pre-filled with AI data
5.  Operator reviews, optionally fixes fields, taps "Save Transaction"
6.  confirm-transaction Edge Function runs:
      a. Applies edits to the transaction row (not yet in the ledger, so no reversal needed)
      b. Resolves the effective fee_rules row
      c. Builds the balanced postings for the type
      d. Inserts one ledger_entries row + its postings atomically (idempotency key)
      e. Status → confirmed or edited
7.  Dashboard re-reads account_balances on next navigation
```

> 🔴 **TARGET.** Today step 3f writes `status: "confirmed"` and moves balances, and
> `confirm-transaction` is an edit endpoint. Step 7 is a refetch, not a push.

### 7.2 Interrupted Path (Left Before Saving)

```
1–4. Same as happy path
5.   Operator leaves app before saving
6.   Transaction stays in DB with status: awaiting_confirm
     No ledger entry exists, so no balance reflects it
7.   Dashboard shows "To Review" badge
8.   Operator returns, reviews, saves → Phase 2 completes
```

> The live database already has `idx_gocash_tx_pending ... WHERE status = 'awaiting_confirm'`.
> The schema anticipated this gate; the gate was built and then bypassed.

---

## 8. Out of Scope (V1)

- Automated reporting / exports (CSV, PDF)
- iOS Share Extension (P2 — Android share intent is P1)
- Biometric lock screen
- Offline mode / queue (transactions require network for AI processing)
- **Billing and self-serve signup** — deferred, not cancelled. See below
- **BYO OpenAI key** — makes support impossible and removes the pricing lever

### Changes to this list (2026-09-23)

**Removed: "Multi-operator admin panel".** Multi-tenant SaaS is the product target, so
excluding multi-operator support contradicted §2. What is actually deferred is the *revenue
machinery* — self-serve signup, PayMongo checkout, tiers, dunning — which is 2–3 weeks of
work against zero validation (2 operators, 1 transaction live). Tenant-safe architecture is
in scope now and is cheap, because every table is already `operator_id`-scoped.

**Changed: "Auto-confirmation (a human must always review before wallets update)".**

The plan ships `operators.settings.auto_confirm_below_minor` — a per-operator threshold
below which a transaction skips the gate. **Default 0, i.e. off.** This is a deliberate
concession, recorded rather than quietly dropped:

- The requirement's *intent* stands: a human reviews before money moves, and that is the
  default for every operator on every transaction.
- The concession exists because auto-confirm was almost certainly introduced in the first
  place *because the gate was expensive* — the 18-argument `confirm_transaction_atomic` was
  a hand-rolled reversal engine. Once confirming is "insert one balanced entry with an
  idempotency key", that pressure disappears, and a bounded opt-in is safer than the
  unbounded bypass that exists in production today.
- It is a natural paid-tier feature (`plans.auto_confirm_allowed`).
- The risk it accepts is bounded by the threshold: a misread ₱1,850 → ₱1,850,000 is far
  above any sane threshold and still hits the gate.

**Note on sequencing:** a verified restore of the GoCash database is a hard gate before any
paying customer. The offsite backup has failed 33 consecutive nights and no restore has ever
been tested. Do not hold a stranger's financial records against a single un-restored copy on
one SSD.
