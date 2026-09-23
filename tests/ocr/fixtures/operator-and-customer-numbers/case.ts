/**
 * PROBE: the required two-numbers case. The receipt shows the operator's own
 * number FIRST (in the account header) and the customer's second, and the
 * model declined to pick one. `extractAccountNumber` must skip the operator's.
 *
 * WHY IT BREAKS: the fallback scans with /(?:\+639|09)\d{9}/g and returns the
 * FIRST match that is not blacklisted. Order on the screen is the only thing
 * standing between the books and the operator's own number, and on a "You
 * received" screen the operator's number is rendered above the customer's —
 * i.e. the wrong one is always first. The blacklist is the entire defence, and
 * it is a hardcoded two-element array in the deployed source
 * (DEFAULT_BLACKLIST in transaction-processing.ts), not operator data.
 *
 * Note also that one of the two blacklist entries, "13990000002", cannot ever
 * match that regex — it starts with "13". Half the defence is dead code.
 *
 * And the defence only covers THIS path. See
 * operator-number-returned-by-model for the hole next to it.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "operator-and-customer-numbers",
  probe: "Operator number precedes the customer's; the blacklist must skip it.",
  why: "First-match-wins scan; on a 'You received' screen the operator's number is always first.",
  expected: {
    platform: "GCash",
    transaction_type: "Cash Out",
    amount_php: 1500,
    reference_number: "1029384756124",
    account_number: "09171234567",
    fee_php: 30,
    postings: [
      { account: "GCash", php: 1500 },
      { account: "cash", php: -1470 },
      { account: "revenue", php: -30 },
    ],
  },
};
