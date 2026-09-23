/**
 * The six transaction types, as balanced ledger entries.
 *
 * THE ONE RULE: every entry's postings sum to exactly zero.
 *
 * That rule is what the delta-multiplier model was missing. On a PHP 100
 * transaction the old deltas should have summed to the fee earned. Live, four
 * of six types did not: Telco Load and Bills Payment came to -95, Bank
 * Transfer to -100, and Profit Remittance was booked as a cash-in. Nothing
 * detected it because nothing asserted it. Here the arithmetic is checked in
 * `balanced()` and again by a deferred constraint trigger in the database.
 *
 * Each type is written out in full rather than sharing a helper. Four of them
 * currently have the same shape, and that duplication is deliberate: you can
 * read any single function and see every sign without following an
 * indirection. That is exactly what three NUMERIC(6,4) columns could not give.
 */

import { type Minor, MAX_AMOUNT_MINOR } from "./money.ts";
import type { AccountRef, Posting } from "./types.ts";

export interface EntryInput {
  /** Face value in centavos. Always positive. */
  amountMinor: Minor;
  /** Operator fee in centavos. Always positive; 0 is allowed. */
  feeMinor: Minor;
  /** Platform code, e.g. "GCash". */
  platform: string;
}

export class LedgerError extends Error {}

/**
 * Sanity-check a transaction's inputs before any postings are built.
 *
 * `balanced()` only proves the legs sum to zero, and a sum of zero says
 * nothing about whether the entry is meaningful. A review found three ways a
 * nonsensical entry passed every guard:
 *
 *   - a negative amount produced a reversal booked as kind='transaction',
 *   - a negative fee moved money OUT of revenue,
 *   - and on Cash Out, a fee larger than the amount flipped the cash leg
 *     positive, so the books recorded RECEIVING cash on a cash out.
 *
 * The last one is reachable in production, not theoretical: calculateFee has a
 * PHP 5 floor, so any Cash Out below PHP 5 yields fee > amount. A PHP 1.00
 * cash out posted cash +400.
 */
function assertSaneInput(
  txType: string,
  amountMinor: Minor,
  feeMinor: Minor,
  opts: { feeDeducted: boolean }
): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new LedgerError(
      `${txType}: amount must be a non-negative integer number of centavos, got ${amountMinor}`
    );
  }
  if (!Number.isSafeInteger(feeMinor) || feeMinor < 0) {
    throw new LedgerError(
      `${txType}: fee must be a non-negative integer number of centavos, got ${feeMinor}`
    );
  }
  if (amountMinor > MAX_AMOUNT_MINOR) {
    throw new LedgerError(
      `${txType}: amount ${amountMinor} exceeds the maximum of ${MAX_AMOUNT_MINOR} centavos`
    );
  }
  if (opts.feeDeducted && feeMinor > amountMinor) {
    throw new LedgerError(
      `${txType}: fee ${feeMinor} exceeds the amount ${amountMinor}; the payout would be ` +
      `negative, which would record cash coming IN on a cash out`
    );
  }
}

/**
 * Validates and normalises a set of postings.
 *
 * Drops zero-value legs (a fee of 0 needs no revenue row) and refuses to return
 * anything that does not balance. If a sign is mistyped in one of the builders
 * below, its tests fail immediately instead of the mistake reaching production
 * and quietly destroying money for six months.
 */
export function balanced(postings: readonly Posting[]): Posting[] {
  for (const p of postings) {
    if (!Number.isSafeInteger(p.amount)) {
      throw new LedgerError(
        `posting amounts must be integer centavos, got ${p.amount} on ${describe(p.account)}`
      );
    }
  }

  const kept = postings.filter((p) => p.amount !== 0);

  if (kept.length < 2) {
    throw new LedgerError(
      `a ledger entry needs at least 2 postings, got ${kept.length} — check that amount > 0`
    );
  }

  // Integer arithmetic, so this is an exact comparison with no tolerance.
  const sum = kept.reduce((s, p) => s + p.amount, 0);
  if (sum !== 0) {
    const legs = kept
      .map((p) => `${describe(p.account)} ${p.amount > 0 ? "+" : ""}${p.amount}`)
      .join(", ");
    throw new LedgerError(
      `ledger entry does not balance: sum = ${sum} centavos (expected 0). Legs: ${legs}`
    );
  }

  return [...kept];
}

function describe(a: AccountRef): string {
  return a.kind === "platform" ? a.platform : a.kind;
}

/**
 * Negate every leg. This is the whole of "undo".
 *
 * Editing a confirmed transaction becomes: reverse the old entry, post a new
 * one, keep both. That replaces the live 18-argument confirm_transaction_atomic
 * with its p_previous_platform_wallet / p_next_platform_wallet pairs — which is
 * a hand-rolled version of exactly this.
 */
export function reverse(postings: readonly Posting[]): Posting[] {
  return balanced(postings.map((p) => ({ ...p, amount: -p.amount })));
}

// ---------------------------------------------------------------------------
// The six types
// ---------------------------------------------------------------------------

/**
 * CASH IN — the customer hands over cash and receives e-money.
 * The fee is added ON TOP: a PHP 500 cash in at PHP 10 means they give you 510.
 *
 *   Cash    +510.00   they handed over 500 + 10
 *   GCash   -500.00   you sent them 500
 *   Revenue  -10.00   you earned 10
 *
 * Direction confirmed by the operator and matching the live OCR prompt and the
 * live DB rules. The PRD, TECH_SPEC, Settings copy and onboarding seed all had
 * it backwards; those are corrected separately.
 */
export function cashIn({ amountMinor, feeMinor, platform }: EntryInput): Posting[] {
  assertSaneInput("cashIn", amountMinor, feeMinor, { feeDeducted: false });
  return balanced([
    { account: { kind: "cash" }, amount: amountMinor + feeMinor },
    { account: { kind: "platform", platform }, amount: -amountMinor },
    { account: { kind: "revenue" }, amount: -feeMinor },
  ]);
}

/**
 * CASH OUT — the customer sends e-money and receives cash.
 * The fee is DEDUCTED here: a PHP 1,000 cash out at PHP 20 pays out 980.
 *
 *   GCash   +1000.00
 *   Cash     -980.00   1000 minus the 20 fee
 *   Revenue   -20.00
 *
 * The asymmetry with Cash In (added on top vs deducted) is real and comes from
 * the live rules. It was invisible while it lived in multiplier columns.
 */
export function cashOut({ amountMinor, feeMinor, platform }: EntryInput): Posting[] {
  assertSaneInput("cashOut", amountMinor, feeMinor, { feeDeducted: true });
  return balanced([
    { account: { kind: "platform", platform }, amount: amountMinor },
    { account: { kind: "cash" }, amount: -(amountMinor - feeMinor) },
    { account: { kind: "revenue" }, amount: -feeMinor },
  ]);
}

/**
 * TELCO LOAD — you buy prepaid load from your e-wallet, the customer pays cash.
 *
 * BROKEN LIVE: the rule records the platform debit but credits only the fee to
 * cash, so the customer's payment is never booked and the principal vanishes
 * on every load.
 */
export function telcoLoad({ amountMinor, feeMinor, platform }: EntryInput): Posting[] {
  assertSaneInput("telcoLoad", amountMinor, feeMinor, { feeDeducted: false });
  return balanced([
    { account: { kind: "cash" }, amount: amountMinor + feeMinor },
    { account: { kind: "platform", platform }, amount: -amountMinor },
    { account: { kind: "revenue" }, amount: -feeMinor },
  ]);
}

/**
 * BILLS PAYMENT — you pay a customer's bill from your e-wallet, they pay cash.
 *
 * BROKEN LIVE: same shape of error as Telco Load. On a PHP 1,850 Meralco bill
 * the books lose 1,835.
 */
export function billsPayment({ amountMinor, feeMinor, platform }: EntryInput): Posting[] {
  assertSaneInput("billsPayment", amountMinor, feeMinor, { feeDeducted: false });
  return balanced([
    { account: { kind: "cash" }, amount: amountMinor + feeMinor },
    { account: { kind: "platform", platform }, amount: -amountMinor },
    { account: { kind: "revenue" }, amount: -feeMinor },
  ]);
}

/**
 * BANK TRANSFER — you send to a bank from your e-wallet, the customer pays cash.
 *
 * BROKEN LIVE: the worst of the three — the cash leg is zero AND the fee is
 * never booked, so the full principal disappears.
 */
export function bankTransfer({ amountMinor, feeMinor, platform }: EntryInput): Posting[] {
  assertSaneInput("bankTransfer", amountMinor, feeMinor, { feeDeducted: false });
  return balanced([
    { account: { kind: "cash" }, amount: amountMinor + feeMinor },
    { account: { kind: "platform", platform }, amount: -amountMinor },
    { account: { kind: "revenue" }, amount: -feeMinor },
  ]);
}

/**
 * PROFIT REMITTANCE — you take cash out of the drawer for yourself.
 * No platform wallet, no fee.
 *
 *   Cash   -5000.00   out of the drawer
 *   Equity +5000.00   the owner took it
 *
 * BROKEN LIVE: the "all" rule reads platform -1 / cash +1, which records a
 * remittance as a cash-in, and the Maya row disagrees with it. Neither names
 * where the money went. Here the second leg has to go somewhere, so the
 * destination cannot be left ambiguous.
 */
export function profitRemittance({ amountMinor }: Pick<EntryInput, "amountMinor">): Posting[] {
  assertSaneInput("profitRemittance", amountMinor, 0, { feeDeducted: false });
  return balanced([
    { account: { kind: "cash" }, amount: -amountMinor },
    { account: { kind: "equity" }, amount: amountMinor },
  ]);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const BUILDERS: Record<string, (i: EntryInput) => Posting[]> = {
  "Cash In": cashIn,
  "Cash Out": cashOut,
  "Telco Load": telcoLoad,
  "Bills Payment": billsPayment,
  "Bank Transfer": bankTransfer,
  "Profit Remittance": (i) => profitRemittance(i),
};

/** Build the entry for a transaction type. Throws on an unknown type. */
export function buildPostings(txType: string, input: EntryInput): Posting[] {
  const builder = BUILDERS[txType];
  if (!builder) throw new LedgerError(`unknown transaction type: ${txType}`);
  return builder(input);
}

// ---------------------------------------------------------------------------
// Non-transaction entries
// ---------------------------------------------------------------------------

/** Opening balances, with the owner's stake as the balancing leg. */
export function openingBalances(
  balances: readonly { account: AccountRef; amount: Minor }[]
): Posting[] {
  const total = balances.reduce((s, b) => s + b.amount, 0);
  return balanced([...balances, { account: { kind: "equity" }, amount: -total }]);
}

/**
 * The nightly drawer count.
 *
 * Settings > Wallets currently overwrites a balance and leaves no trace, so an
 * operator can never tell whether they are short or the app is wrong. Here the
 * difference is a posting that stays visible.
 */
export function reconcile({
  account,
  bookBalanceMinor,
  countedBalanceMinor,
}: {
  account: AccountRef;
  bookBalanceMinor: Minor;
  countedBalanceMinor: Minor;
}): Posting[] {
  const difference = countedBalanceMinor - bookBalanceMinor;
  return balanced([
    { account, amount: difference },
    { account: { kind: "equity" }, amount: -difference },
  ]);
}
