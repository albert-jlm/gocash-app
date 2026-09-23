/**
 * PROBE: the required null-amount case. The model does exactly what the system
 * prompt demands — "Never guess amounts" — and returns null.
 *
 * WHY IT BREAKS: the glue is `const amount = ai.amount ?? 0;`. There is no
 * branch for "the amount is unknown". A refusal to guess is converted into a
 * confident assertion that the transaction was worth nothing, and processing
 * continues.
 *
 * Then the fee floor does the damage. `calculateFee` returns
 * ceil(max(0 x 2%, PHP 5)) = PHP 5 on a zero amount, so `cashIn` is called
 * with amount 0 and fee 500. The platform leg is 0, `balanced()` drops
 * zero-value legs, and what survives is:
 *
 *     cash    +5.00
 *     revenue -5.00
 *
 * Two legs, sums to zero, passes every guard in postings.ts and the deferred
 * constraint trigger in the database. The operator's drawer is credited PHP 5
 * that nobody handed over, PHP 5 of revenue is invented, and the PHP 1,200
 * that actually moved is never recorded at all.
 *
 * KNOWN FAILURE (balanced_wrong). This is the most dangerous class in the
 * report: there is no error, no unbalanced entry, and nothing downstream can
 * tell it apart from a real PHP 5 transaction. The prompt's most careful
 * instruction produces the least detectable corruption.
 *
 * The fix is a guard in _process_transaction.ts — reject a null amount instead
 * of defaulting it — which is not this harness's to make.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "null-amount-cash-in",
  probe: "amount: null on a Cash In. `ai.amount ?? 0` turns 'unknown' into 'zero'.",
  why: "Zero amount + PHP 5 fee floor = a balanced two-leg entry that invents revenue.",
  expected: {
    platform: "GCash",
    transaction_type: "Cash In",
    amount_php: 1200,
    reference_number: "4455667788990",
    account_number: "09051238490",
    fee_php: 24,
    postings: [
      { account: "cash", php: 1224 },
      { account: "GCash", php: -1200 },
      { account: "revenue", php: -24 },
    ],
  },
  known_failure: {
    kind: "balanced_wrong",
    why:
      "`ai.amount ?? 0` defaults a refused read to zero; the PHP 5 fee minimum then " +
      "produces cash +5 / revenue -5. Balanced, undetectable, and entirely fictional.",
    actual: {
      amount_php: 0,
      fee_php: 5,
      postings: [
        { account: "cash", php: 5 },
        { account: "revenue", php: -5 },
      ],
    },
  },
};
