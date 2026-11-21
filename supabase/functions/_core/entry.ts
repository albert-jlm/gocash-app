/**
 * What one transaction would do to the books.
 *
 * WHY THIS IS A FUNCTION AND NOT THREE CALLS AT EACH SITE
 * Pricing an entry is three steps — resolve the rule in force, compute the fee,
 * build the legs — and before this existed each caller did them by hand:
 * `_confirm_transaction.ts`, `_create_transaction.ts`, and the entry form. Three
 * copies of a sequence where the order matters (the fee feeds the legs) and
 * where one of them resolving the rule slightly differently is invisible until
 * an operator is paid the wrong amount. That is the shape of AUDITS.md #5
 * finding 4, the defect this rebuild exists to remove.
 *
 * It is pure: no I/O, no clock, no runtime globals. The caller supplies the
 * rules it has already read, so this module runs unchanged in Deno, in the
 * browser, and under vitest — which is the only reason the form's preview can
 * be asserted to equal what the gate will post.
 */

import { calculateFee, resolveFeeRule } from "./fees.ts";
import { buildPostings } from "./postings.ts";
import { toPesos, type Minor } from "./money.ts";
import type { FeeRule, Posting, TransactionType } from "./types.ts";

export interface EntryQuote {
  /** The operator's fee, in centavos. */
  feeMinor: Minor;
  /** The same figure in pesos, for display. Never used in arithmetic. */
  feePesos: number;
  /** The legs this entry would post. Sums to zero by construction. */
  postings: Posting[];
  /**
   * The rule the fee came from, or null when none covered this combination.
   *
   * Null is NOT an error here and the fee is 0, matching `calculateFee`. The
   * distinction matters to the caller: at the confirmation gate an unpriced
   * transaction is a 422, on a form it is a warning the operator can act on by
   * setting a rule. Returning the rule rather than a boolean lets either
   * caller say which rule it used, which is the question "why was this ₱7?"
   */
  rule: FeeRule | null;
}

export interface EntryQuoteInput {
  transactionType: TransactionType;
  /**
   * Ignored for Profit Remittance, which touches no platform wallet. Callers
   * pass whatever they have; this function substitutes 'Unknown' rather than
   * making every caller remember to.
   */
  platform: string;
  amountMinor: Minor;
  /**
   * Cash Out only, and only from an explicit answer. See FeeOptions in fees.ts:
   * inferring this was wrong on roughly one amount in fifty-one.
   */
  amountIncludesFee?: boolean;
  /**
   * Wallet Transfer only. `platform` is the source and `transferTo` the
   * destination; either may be "Cash". `platformFeeMinor` is what the platform
   * charged for the move, as the operator read it off the receipt.
   */
  transferTo?: string;
  platformFeeMinor?: Minor;
}

/**
 * Price an entry and build its legs.
 *
 * Throws `LedgerError` (from postings.ts) for an input the ledger would refuse
 * — a negative amount, or a Cash Out whose fee exceeds the amount. Throwing
 * rather than returning a partial quote is deliberate: every caller either
 * reports the problem or declines to save, and none of them can do anything
 * useful with a set of legs that will not commit.
 */
export function quoteEntry(
  input: EntryQuoteInput,
  rules: readonly FeeRule[],
): EntryQuote {
  // A Wallet Transfer is the shop moving its own float. It earns nothing, so
  // no fee rule applies to it and none is looked up: the only fee on it is the
  // platform's own charge, which is a cost, not earnings.
  if (input.transactionType === "Wallet Transfer") {
    return {
      feeMinor: 0,
      feePesos: 0,
      postings: buildPostings("Wallet Transfer", {
        amountMinor: input.amountMinor,
        feeMinor: 0,
        platform: input.platform,
        transferTo: input.transferTo,
        platformFeeMinor: input.platformFeeMinor ?? 0,
      }),
      rule: null,
    };
  }

  // Profit Remittance moves cash to the owner and never touches a wallet, so a
  // platform on it would be recorded and never read.
  const platform = input.transactionType === "Profit Remittance" ? "Unknown" : input.platform;

  // resolveFeeRule, not a find() of our own, and the SAME call calculateFee
  // makes below. If these two disagreed the quote could report "no rule covers
  // this" while displaying a fee computed from one.
  const rule = resolveFeeRule(input.transactionType, platform, rules) ?? null;

  // Profit Remittance earns nothing, whatever a rule says.
  //
  // `profitRemittance()` builds two legs — drawer down, equity up — and has no
  // revenue leg to put a fee on, so any fee computed here would be REPORTED and
  // never POSTED. The seed sets this type to 0 bps, but an operator can edit fee
  // rules in Settings, and then the form would promise "you earn PHP 100" for
  // taking PHP 5,000 out of the drawer while the ledger recorded no earnings.
  // Taking your own money out is not a sale; the fee is zero by construction
  // rather than by the data happening to say so.
  const feeMinor = input.transactionType === "Profit Remittance"
    ? 0
    : calculateFee(input.transactionType, platform, input.amountMinor, rules, {
        amountIncludesFee: input.amountIncludesFee === true,
      });

  return {
    feeMinor,
    feePesos: toPesos(feeMinor),
    postings: buildPostings(input.transactionType, {
      amountMinor: input.amountMinor,
      feeMinor,
      platform,
    }),
    rule,
  };
}
