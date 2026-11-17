/**
 * UPDATE 2026-11-18: A null amount is no longer defaulted to 0. The draft is held at the gate with the amount unset.
 * The analysis below describes the behaviour before that change.
 *
 * PROBE: the same null amount as null-amount-cash-in, on the mirrored type.
 * The pair exists to show that the SAME OCR failure lands in two completely
 * different severity classes depending only on which type it happened to be.
 *
 * WHY IT BREAKS: amount defaults to 0, the fee floor still returns PHP 5, and
 * `cashOut` deducts the fee from the amount. `assertSaneInput` in postings.ts
 * catches fee > amount and throws, because the payout would be negative — the
 * books would record cash coming IN on a cash out. So this one fails loudly.
 *
 * KNOWN FAILURE (failed). Failing loudly is the GOOD outcome. The comment in
 * postings.ts already notes this guard is reachable in production, not
 * theoretical, because the PHP 5 floor makes fee > amount for any Cash Out
 * under PHP 5 — and a null amount is the widest door into it.
 *
 * Read against null-amount-cash-in: identical cause, identical model output
 * shape, and one silently corrupts the ledger while the other refuses. The
 * difference is not a safety design, it is an accident of which builder the
 * type happened to dispatch to.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "null-amount-cash-out",
  probe: "amount: null on a Cash Out — the same defect as null-amount-cash-in.",
  why: "Fee floor exceeds the defaulted zero amount, so assertSaneInput throws. Loud, and therefore safe.",
  expected: {
    platform: "Maya",
    transaction_type: "Cash Out",
    amount_php: 2000,
    reference_number: "5512348899002",
    account_number: "09221114444",
    fee_php: 40,
    postings: [
      { account: "Maya", php: 2000 },
      { account: "cash", php: -1960 },
      { account: "revenue", php: -40 },
    ],
  },
  known_failure: {
    kind: "failed",
    why:
      "The model declined to guess the amount. The draft is held until the operator " +
      "enters it. No entry is written.",
    actual: { amount_raw: null, error_contains: "held at the gate" },
  },
};
