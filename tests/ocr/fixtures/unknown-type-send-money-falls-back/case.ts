/**
 * PROBE: the transaction_type "Unknown" path, recovering via detectType().
 *
 * WHY IT BREAKS: `detectType` is first-match-wins over a hand-ordered keyword
 * list, and the order is not neutral. Cash In is tested first, so any receipt
 * containing "sent to" is a Cash In before the Telco Load, Bills Payment or
 * Bank Transfer branches are even reached — and "sent to" appears on GCash
 * load, bills and transfer receipts too. Here the recovery is correct, which
 * is what makes the ordering look safe.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "unknown-type-send-money-falls-back",
  probe: 'transaction_type "Unknown" recovered as Cash In from "You sent".',
  why: "detectType is first-match-wins; the Cash In branch is tested before all others.",
  expected: {
    platform: "GCash",
    transaction_type: "Cash In",
    amount_php: 750,
    reference_number: "3344556677889",
    account_number: "09454014554",
    fee_php: 15,
    postings: [
      { account: "cash", php: 765 },
      { account: "GCash", php: -750 },
      { account: "revenue", php: -15 },
    ],
  },
};
