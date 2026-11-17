/**
 * UPDATE 2026-11-18: detectType no longer defaults to Cash In. The draft is held at the gate with the type unset.
 * The analysis below describes the behaviour before that change.
 *
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
    kind: "failed",
    why:
      "The receipt carries no directional wording, so the type cannot be read from it. " +
      "detectType now returns Unknown instead of defaulting to Cash In, and the draft " +
      "is held until the operator picks the type. No entry is written.",
    actual: { transaction_type: "Unknown", error_contains: "held at the gate" },
  },
};
