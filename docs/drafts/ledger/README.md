# Draft: a double-entry ledger for GoCash

> **Superseded in part.** `postings.ts` and `postings.test.ts` have moved into
> `supabase/functions/_core/` and were converted to integer centavos — that is now
> the only copy of this logic, and it is under test there (60 tests). This file,
> `schema.sql` and `demo.sql` remain as the design reference for the Phase 1
> migrations, which are not written yet.

**Status: draft. Nothing here is wired into the app.** It exists so you can read the
idea against your real transaction types, run it, and decide. Throwing it away costs
nothing.

---

## The idea in one sentence

> Every transaction writes **2–4 signed rows that must add up to zero**, and a wallet
> balance is the **sum of those rows** rather than a number you edit.

That's it. Everything below follows from that sentence.

---

## Why bother — the concrete reason

I ran every rule in your live database through a ₱100 transaction. The two deltas
should add up to the fee you earned:

| Type (`all` rule) | platform Δ | cash Δ | adds up to | should be |
|---|---|---|---|---|
| Cash In | −100 | +105 | **+5** | +5 ✓ |
| Cash Out | +100 | −95 | **+5** | +5 ✓ |
| Telco Load | −100 | +5 | **−95** | +fee ✗ |
| Bills Payment | −100 | +5 | **−95** | +fee ✗ |
| Bank Transfer | −100 | 0 | **−100** | +fee ✗ |
| Profit Remittance | −100 | +100 | 0 | −100 ✗ |

Four of your six types are wrong in production right now, on both operators. On every
bill you pay, ₱1,850 leaves GCash and nothing arrives in the drawer. On every bank
transfer, ₱2,000 vanishes and you don't even book the fee. Profit Remittance is
recorded as a *cash in*.

They've been wrong since seeding. Nothing noticed, because **nothing in the current
design can notice**. There's no rule that says the books must balance, so there's
nothing to violate.

That's the argument. Not "double-entry is good practice" — *this specific bug class
is undetectable today and impossible here.*

---

## What changes

### Before — three multiplier columns

```
transaction_rules
  delta_platform_mult      NUMERIC(6,4)   -- always -1, 0, or +1
  delta_cash_amount_mult   NUMERIC(6,4)   -- always -1, 0, or +1
  delta_cash_mult          NUMERIC(6,4)   -- always -1, 0, or +1

wallets.balance  <- mutated in place: balance = balance + delta
```

Every value in those `NUMERIC(6,4)` columns is `-1`, `0`, or `+1`. You're not
configuring anything — you're storing three signs, in a shape where a sign error is
invisible and nothing cross-checks them.

### After — accounts and postings

```
accounts       GCash, MariBank, Cash  +  Fee Revenue, Owner Equity   (two new)
ledger_entries one journal entry: "this happened, here's why"
postings       the signed rows. Must sum to zero. Append-only.

balance        <- derived:  SELECT sum(amount) WHERE account_id = X
```

---

## The four account kinds

| Kind | What it is | Examples |
|---|---|---|
| `platform` | money in an e-wallet | GCash, MariBank, Maya |
| `cash` | the drawer | Cash |
| `revenue` | fees you've earned | Fee Revenue **(new)** |
| `equity` | the owner's stake | Owner Equity **(new)** |

The two new ones are what make an entry balance. Today a fee has nowhere to go, so
it's smuggled into the cash leg via `delta_cash_mult`. And a profit remittance has no
destination at all — which is exactly why your two live rules for it contradict each
other.

### About the signs

- **platform / cash** — positive means you have more. Intuitive.
- **revenue / equity** — stored *negative* as they grow. That's what balances the
  books.

Don't let that second one bother you. The `account_balances` view has a
`natural_balance` column that flips it, so the dashboard shows `Fee Revenue 25.00`,
not `-25.00`. You only see the negative inside the ledger, where it's doing its job.

---

## All six types, worked out

Real amounts. Check the arithmetic yourself.

### 1. Cash In — customer hands cash, wants e-money

Customer wants ₱500 in their GCash. Your fee is ₱10, so they hand you ₱510.

| Account | Amount | Why |
|---|---|---|
| Cash | **+510.00** | they handed you 500 + 10 |
| GCash | **−500.00** | you sent them 500 |
| Fee Revenue | **−10.00** | you earned 10 |
| | **0.00** | ✓ |

> ⚠️ `onboarding/page.tsx` seeds this **backwards** (`platform +1, cash −1`).
> Production has it the other way. Both can't be right, and nobody noticed.

### 2. Cash Out — customer sends e-money, wants cash

Customer sends you ₱1,000. Fee ₱20, so they walk away with ₱980.

| Account | Amount | Why |
|---|---|---|
| GCash | **+1000.00** | their 1000 landed in your wallet |
| Cash | **−980.00** | you handed over 1000 − 20 |
| Fee Revenue | **−20.00** | you kept 20 |
| | **0.00** | ✓ |

Note the fee is **deducted** here but **added on top** for Cash In. That asymmetry is
real and it's in your live rules — it's just invisible when it's three multiplier
columns.

### 3. Telco Load — you buy load, customer pays cash

₱100 load for a Globe number, ₱3 margin.

| Account | Amount | Why |
|---|---|---|
| Cash | **+103.00** | customer paid 103 |
| GCash | **−100.00** | the load cost you 100 |
| Fee Revenue | **−3.00** | you made 3 |
| | **0.00** | ✓ |

> 🔴 **Live today:** GCash −100, Cash **+3**. The customer's ₱103 is never recorded.
> ₱100 disappears from your books on every load.

### 4. Bills Payment

Meralco bill of ₱1,850, fee ₱15.

| Account | Amount | Why |
|---|---|---|
| Cash | **+1865.00** | customer paid 1850 + 15 |
| GCash | **−1850.00** | you paid the biller |
| Fee Revenue | **−15.00** | you earned 15 |
| | **0.00** | ✓ |

> 🔴 **Live today:** GCash −1850, Cash **+15**. ₱1,850 gone, per bill.

### 5. Bank Transfer

₱2,000 to a BPI account, fee ₱25.

| Account | Amount | Why |
|---|---|---|
| Cash | **+2025.00** | customer paid 2000 + 25 |
| MariBank | **−2000.00** | you sent 2000 out |
| Fee Revenue | **−25.00** | you earned 25 |
| | **0.00** | ✓ |

> 🔴 **Live today:** MariBank −2000, Cash **+0**. The worst of the three — the full
> ₱2,000 vanishes and the fee isn't booked either.

### 6. Profit Remittance — you pocket ₱5,000

| Account | Amount | Why |
|---|---|---|
| Cash | **−5000.00** | out of the drawer |
| Owner Equity | **+5000.00** | you took it; your stake goes down |
| | **0.00** | ✓ |

> 🔴 **Live today:** the `all` rule is `platform −1, cash +1` — which records a
> remittance as *GCash −5000, Cash +5000*. That's a cash in. The Maya row says
> something different again. Neither names where the money went.
>
> Here that ambiguity can't exist: the second leg **has** to go somewhere, so you're
> forced to name Owner Equity.

---

## What this makes possible that isn't possible today

### Editing a confirmed transaction

Right now "Edit Transaction" on a confirmed row is a dead button — it links to
`/confirm`, which returns 409. Production grew an 18-argument
`confirm_transaction_atomic` with `p_previous_platform_wallet` / `p_next_platform_wallet`
pairs to work around this. **That function is a hand-rolled reversal engine.**

Here it's three entries, all kept:

```
entry 1  transaction  Cash +510, GCash -500, Revenue -10    original
entry 2  reversal     Cash -510, GCash +500, Revenue +10    undo
entry 3  transaction  Cash +612, GCash -600, Revenue -12    corrected

net effect on Cash: +510 - 510 + 612 = +612   ✓
```

The 18-arg RPC goes away. "Undo" is just "negate every leg."

### Answering "why is my GCash balance ₱5,550?"

Unanswerable today. Here it's one query — real output from `demo.sql`:

```
  on_date   |    kind     |                memo                |  amount  | running_balance
------------+-------------+------------------------------------+----------+-----------------
 2026-09-23 | opening     | Opening balances at go-live        |  8000.00 |         8000.00
 2026-09-23 | transaction | Cash in 500 for 09171234567        |  -500.00 |         7500.00
 2026-09-23 | transaction | Meralco 1850, fee 15               | -1850.00 |         5650.00
 2026-09-23 | transaction | Cash in 600, fee 12 (corrected)    |  -600.00 |         5050.00
 2026-09-23 | reversal    | Correcting: amount was 600 not 500 |   500.00 |         5550.00
```

### The nightly drawer count

Your operator counts cash at close. Today, Settings → Wallets *overwrites* the number
and leaves no trace — you can never tell whether you're short or the app is wrong.

Books say ₱12,450, you counted ₱12,400:

| Account | Amount |
|---|---|
| Cash | **−50.00** |
| Owner Equity | **+50.00** |
| | **0.00** ✓ |

The ₱50 stays visible forever. If it happens every Tuesday, you'll see it.

### Repairing a bad rule

This is the one that matters most right now. Once you fix Bills Payment, the wrong
balances are still baked in — `balance = balance + delta` can't be un-applied.

With postings, balances are **derived**. Fix the rule, reverse the bad entries, repost.
The four broken types above become a data-repair job instead of a manual
reconciliation nightmare.

### Double-confirm

`ledger_entries.idempotency_key` is unique per operator. A double-tap or a retry
replays the same key and the second insert is rejected — even when the first request
*succeeded* but the response was lost. That's strictly stronger than the status guard
the live function is missing.

---

## What stays as data

Direction moves into code. **Pricing stays configurable**, because that genuinely
varies per operator:

- fee rate (2%, 3%)
- fee minimum (₱5, ₱3)
- tiers, if you ever want them

`calculateProfit()` and the `profit_rate` / `profit_minimum` columns stay exactly as
they are. The fee is an *input* to the posting functions, not something they decide.

The distinction is the whole point:

> **How much you charge** is a business decision → data.
> **Which direction the money moves** is a fact about the transaction → code.

---

## The files

| File | What it is |
|---|---|
| `postings.ts` | The six types as pure functions. Read this first. |
| `postings.test.ts` | 30 tests, written as readable examples. |
| `schema.sql` | Tables, the zero-sum constraint, RLS, backfill. |
| `demo.sql` | Executable walkthrough — 9 scenarios including the failures. |

### Run the tests

```bash
npx vitest run docs/drafts/ledger
```

### Run the walkthrough against a scratch database

```bash
docker exec supabase-db psql -U postgres -d postgres -c "CREATE DATABASE ledger_draft_test;"
```

Then create the stubs (`gocash.operators`, `gocash.transactions`, `auth.uid()`), apply
`schema.sql`, and run `demo.sql`. Scenarios 3, 5 and 6 are *supposed* to error — those
errors are the feature.

---

## Honest costs

**More rows.** 3 per transaction instead of 1. At your volume (1 transaction, 2
operators) this is meaningless; at 100k it's still fine with the indexes in
`schema.sql`.

**Balances need a sum.** If it's ever slow, cache it in a table refreshed by a trigger
— but keep the view as the source of truth so the cache can always be rebuilt. Don't
pre-optimise this.

**A concept to learn.** Genuinely a cost. But you already carry this complexity — it's
just scattered across three multiplier columns, an 18-argument RPC, a `net_profit`
column and an untraceable manual-override path. This *consolidates* it. And the
operator never sees a posting; it's internal.

**It doesn't fix everything.** Still separately needed: the `SECURITY DEFINER` grants
(Audit #5a finding 1), repo↔production drift, and the inverted `DEFAULT_RULES` seed.

---

## The cheaper alternative, stated fairly

Keep mutable balances; just replace the three multiplier columns with the six
functions in `postings.ts` returning `{platform, cash}`. **About an hour.**

Fixes: readability, the inversion risk, and the four broken types.
Doesn't fix: unrecomputable balances, reversals, reconciliation, double-confirm.

It's a real stopping point, not a wrong answer. You'd be choosing to keep the part
that can't self-check.

---

## My recommendation

Do the full version, now. You have **one transaction and two operators** — the
migration is nearly free and this is the cheapest it will ever be. The backfill at the
bottom of `schema.sql` is about 20 lines.

If there were 50,000 transactions I'd say wrap it incrementally. There aren't.
