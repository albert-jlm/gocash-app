/**
 * PROBE: the required missing-reference case. The model correctly returns
 * null because the reference is not on screen.
 *
 * WHY IT MATTERS — AND WHY THIS "PASSING" FIXTURE IS THE WORRYING ONE:
 * the ledger entry is perfect. Nothing fails. But the reference number is the
 * ONLY duplicate key the system has: `_process_transaction.ts` skips its
 * duplicate lookup entirely when `ai.reference_number` is falsy, and the
 * unique constraint it relies on cannot fire on a NULL. So a receipt with no
 * visible reference can be captured twice and posted twice, and both entries
 * will balance, and the operator's books will be exactly one transaction
 * richer with no error anywhere.
 *
 * Cropping above the reference line is the single most common capture mistake
 * an operator makes, which puts this on the hot path rather than the edge.
 * The harness scores a correctly-returned null as a HIT — it is a correct read
 * — and the risk is recorded here and in tests/ocr/README.md instead.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "missing-reference-number",
  probe: "reference_number null because it is genuinely not on the screenshot.",
  why: "A null reference silently disables duplicate detection; both copies balance.",
  expected: {
    platform: "Maya",
    transaction_type: "Cash In",
    amount_php: 250,
    reference_number: null,
    account_number: "09338887777",
    fee_php: 5,
    postings: [
      { account: "cash", php: 255 },
      { account: "Maya", php: -250 },
      { account: "revenue", php: -5 },
    ],
  },
};
