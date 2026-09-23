/**
 * PROBE: the sixth transaction type. Profit Remittance.
 *
 * WHY IT BREAKS: it cannot be reached through OCR at all. Not "rarely" — at
 * all. Two independent reasons:
 *
 *   1. The EXTRACTION_PROMPT's enum is
 *        "Cash In" | "Cash Out" | "Telco Load" | "Bills Payment" |
 *        "Bank Transfer" | "Unknown"
 *      "Profit Remittance" is not an option. A model in JSON mode cannot
 *      return a value it was not offered.
 *   2. `detectType` has no branch for it either, and its default is "Cash In".
 *
 * So the fallback cannot rescue what the prompt cannot express. One of the six
 * types the ledger supports is unreachable from the capture flow, and this is
 * the type where the operator takes money OUT of the business — the one that
 * most needs an audit trail.
 *
 * The damage when an operator photographs the nearest thing (a transfer to
 * their own account) is severe and in the worst possible direction:
 *
 *     truth   cash -5,000   equity +5,000     (drawer down; the owner took it)
 *     actual  cash +5,100   GCash -5,000   revenue -100
 *
 * The drawer is booked UP 5,100 when 5,000 physically left it — a PHP 10,100
 * swing — and PHP 100 of revenue is invented on a transaction that earns
 * nothing. Both entries balance. The operator's own drawings are recorded as
 * customer business, so profitability is overstated and equity never moves.
 *
 * KNOWN FAILURE (balanced_wrong). The fix is a prompt change plus a
 * `detectType` branch, neither of which this harness owns. Note that even the
 * fee side is confused today: the provisioning seed gives Profit Remittance a
 * 2% / PHP 5 fee rule, while `profitRemittance()` in postings.ts takes no fee
 * argument and silently ignores one. Whichever way the type is reached, the
 * fee computed for it goes nowhere.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "profit-remittance-unreachable",
  probe: "Profit Remittance — the sixth type, absent from the prompt enum and from detectType.",
  why: "The model is never offered the value and the fallback has no branch for it. The type is unreachable from capture.",
  expected: {
    platform: "GCash",
    transaction_type: "Profit Remittance",
    amount_php: 5000,
    reference_number: "8812345678901",
    account_number: null,
    fee_php: 0,
    postings: [
      { account: "cash", php: -5000 },
      { account: "equity", php: 5000 },
    ],
  },
  known_failure: {
    kind: "balanced_wrong",
    why:
      "EXTRACTION_PROMPT does not offer \"Profit Remittance\" and detectType has no branch " +
      "for it, so the type is unreachable. Booked as a Cash In: drawer +5,100 instead of " +
      "-5,000 (a PHP 10,100 swing), PHP 100 of invented revenue, and equity never moves.",
    actual: {
      transaction_type: "Cash In",
      fee_php: 100,
      postings: [
        { account: "cash", php: 5100 },
        { account: "GCash", php: -5000 },
        { account: "revenue", php: -100 },
      ],
    },
  },
};
