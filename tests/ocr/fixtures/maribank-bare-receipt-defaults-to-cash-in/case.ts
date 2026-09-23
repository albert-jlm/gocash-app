/**
 * PROBE: the highest-severity case in the set. A receipt with no directional
 * wording at all, on the platform whose success screen carries the least text.
 *
 * WHY IT BREAKS: the model honestly returns "Unknown" because the screen says
 * "Successful" and an amount and nothing else. Control passes to `detectType`,
 * whose last line is:
 *
 *     return "Cash In";
 *
 * There is no "Unknown" outcome and no confidence signal. An unreadable
 * receipt is not flagged, it is silently classified as the most common type.
 *
 * The truth here is a CASH OUT. Cash In and Cash Out are mirror images, so
 * getting the direction wrong does not shade the entry, it inverts it:
 *
 *     truth   MariBank +1,000   cash -980     revenue -20
 *     actual  MariBank -1,000   cash +1,020   revenue -20
 *
 * The drawer moves PHP 2,000 in the wrong direction on a PHP 1,000
 * transaction, and the MariBank wallet moves 2,000 the wrong way too. Both
 * entries balance perfectly. The ledger invariant — the one thing this rebuild
 * added to catch bad money — cannot see this at all, because a sign error is
 * still a zero sum.
 *
 * KNOWN FAILURE (balanced_wrong). This is the case that justifies the harness:
 * it is a pure OCR failure, it produces a structurally valid ledger entry, and
 * the only thing standing between it and the operator's books is whether a
 * human notices "Cash In" on the confirmation screen.
 *
 * MariBank is not an unusual platform for this operator — it is one of the
 * three supported, and its receipts are the sparsest of the three.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "maribank-bare-receipt-defaults-to-cash-in",
  probe: "No directional wording; detectType falls through to its `return \"Cash In\"` default.",
  why: "detectType has no 'unknown' outcome. A Cash Out read as a Cash In inverts every leg and still balances.",
  expected: {
    platform: "MariBank",
    transaction_type: "Cash Out",
    amount_php: 1000,
    reference_number: "MB-5501123456789",
    account_number: null,
    fee_php: 20,
    postings: [
      { account: "MariBank", php: 1000 },
      { account: "cash", php: -980 },
      { account: "revenue", php: -20 },
    ],
  },
  known_failure: {
    kind: "balanced_wrong",
    why:
      "detectType's fallthrough default is \"Cash In\". The direction inverts: cash goes " +
      "+1,020 instead of -980 and the wallet -1,000 instead of +1,000. PHP 2,000 of error " +
      "on a PHP 1,000 receipt, in a perfectly balanced entry.",
    actual: {
      transaction_type: "Cash In",
      fee_php: 20,
      postings: [
        { account: "cash", php: 1020 },
        { account: "MariBank", php: -1000 },
        { account: "revenue", php: -20 },
      ],
    },
  },
};
