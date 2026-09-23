/**
 * PROBE: the same gross Cash Out, with the confirmation gate NOT answered —
 * the default every time an operator taps straight through.
 *
 * WHY IT BREAKS: `amountIncludesFee` defaults to false, so the fee is charged
 * on the printed 5,100 instead of the real 5,000 base: 2% of 5,100 is 102, not
 * 100. The customer is handed 4,998 instead of the 5,000 they paid for, and
 * PHP 2 of fee-on-fee is booked as revenue.
 *
 * KNOWN FAILURE (balanced_wrong). The entry sums to zero and every sign is
 * right; only the split between cash and revenue is wrong. A PHP 2 error is
 * small, invisible, and happens on every gross cash out — and it is the
 * CUSTOMER who is short, at the counter, in front of the operator. That is a
 * trust problem long before it is an accounting one.
 *
 * This is the deliberate trade fees.ts made: the old code guessed and was
 * wrong on ~387 whole-peso amounts under 20,000; the new code refuses to guess
 * and is wrong whenever nobody answers. Neither is fixable from the image,
 * because the fact is not in the image. What IS fixable, and is not this
 * harness's to fix, is that nothing forces the answer:
 * `detectGrossAmount` would flag this exact amount as likely-gross, and
 * `_process_transaction.ts` never calls it.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "maya-cash-out-gross-gate-missed",
  probe: "Gross Cash Out (5,100 = 5,000 + fee) with the gate left unanswered.",
  why: "Default amountIncludesFee=false charges fee-on-fee; the customer is shorted PHP 2 at the counter.",
  expected: {
    platform: "Maya",
    transaction_type: "Cash Out",
    amount_php: 5100,
    reference_number: "5512348899010",
    account_number: "09207778888",
    fee_php: 100,
    postings: [
      { account: "Maya", php: 5100 },
      { account: "cash", php: -5000 },
      { account: "revenue", php: -100 },
    ],
  },
  known_failure: {
    kind: "balanced_wrong",
    why:
      "No gross/net signal exists in the OCR response and nothing calls detectGrossAmount, " +
      "so the fee is charged on the gross figure. Customer receives 4,998 instead of 5,000.",
    actual: {
      fee_php: 102,
      postings: [
        { account: "Maya", php: 5100 },
        { account: "cash", php: -4998 },
        { account: "revenue", php: -102 },
      ],
    },
  },
};
