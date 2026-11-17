/**
 * UPDATE 2026-11-18: The blacklist now runs over the model's own answer too; the customer's number is recovered from the text.
 * The analysis below describes the behaviour before that change.
 *
 * PROBE: the model confidently returns the OPERATOR's own number as
 * account_number. The blacklist never gets a chance to reject it.
 *
 * WHY IT BREAKS: the glue is
 *
 *     ai.account_number ?? extractAccountNumber(rawText) ?? null
 *
 * The blacklist lives INSIDE `extractAccountNumber`, and `??` short-circuits,
 * so the blacklist is only consulted when the model answered null. A confident
 * wrong answer bypasses the only safeguard there is. The prompt does tell the
 * model "Operator blacklist (never use): 09990000001, 13990000002" — but a
 * prompt is a request, not a constraint, and this is exactly the instruction a
 * model drops when the number is the most visually prominent one on screen.
 * The operator's number sits in the account header in large type; the
 * customer's is small text in the transaction body.
 *
 * KNOWN FAILURE (fields_only). The ledger entry is correct — this does not
 * move money the wrong way. It corrupts the customer record: every
 * transaction filed under the operator's own number, so per-customer history,
 * dedupe-by-customer and any future receivables view are all wrong. Fixing it
 * means running the blacklist over the model's answer too, which is a change
 * to _process_transaction.ts and outside this harness's remit.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "operator-number-returned-by-model",
  probe: "Model answers with the operator's own number; the blacklist is bypassed by ??.",
  why: "The blacklist only runs inside the fallback, never over the model's own answer.",
  expected: {
    platform: "GCash",
    transaction_type: "Cash Out",
    amount_php: 800,
    reference_number: "1029384756125",
    account_number: "09171234567",
    fee_php: 16,
    postings: [
      { account: "GCash", php: 800 },
      { account: "cash", php: -784 },
      { account: "revenue", php: -16 },
    ],
  },
};
