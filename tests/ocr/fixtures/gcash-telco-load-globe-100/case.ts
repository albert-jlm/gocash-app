/**
 * PROBE: Telco Load, and the PHP 5 minimum fee dominating a small amount.
 *
 * WHY IT MATTERS: 2% of PHP 100 is PHP 2, so the floor decides the fee. Load
 * is the highest-volume, lowest-value transaction an agent does, which makes
 * it the type where a fee-floor regression would be least visible per
 * transaction and largest in aggregate. Telco Load was also broken live: the
 * rule credited only the fee to cash, so the customer's PHP 100 was never
 * booked and the principal disappeared on every single load.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "gcash-telco-load-globe-100",
  probe: "Telco Load where the PHP 5 minimum, not the 2% rate, sets the fee.",
  why: "Highest-volume type; the fee floor is the only thing pricing it.",
  expected: {
    platform: "GCash",
    transaction_type: "Telco Load",
    amount_php: 100,
    reference_number: "7008123456789",
    account_number: "09171234567",
    fee_php: 5,
    postings: [
      { account: "cash", php: 105 },
      { account: "GCash", php: -100 },
      { account: "revenue", php: -5 },
    ],
  },
};
