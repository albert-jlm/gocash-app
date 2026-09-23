/**
 * PROBE: a non-round amount with centavos, on a type that does NOT round the
 * fee up to a whole peso.
 *
 * WHY IT MATTERS: Cash In and Cash Out round the fee up (an operator quotes
 * whole pesos across the counter); the other four keep centavo precision. So
 * 1,850.75 x 2% must stay 37.02 and not become 38. Every real bill is a
 * non-round amount, and this is the only place fractional money enters the
 * ledger — if centavos are going to drift anywhere, it is here. The entry is
 * asserted in integer centavos, so a half-centavo would fail loudly rather
 * than hide behind an epsilon.
 *
 * It also carries a SERVICE ACCOUNT number (0301234567) next to a mobile
 * number, which is the shape that tempts a digit-matching extractor into
 * returning the wrong one.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "maya-bills-payment-meralco",
  probe: "Bills Payment with centavos; fee must keep centavo precision (37.02, not 38).",
  why: "Only four of six types keep centavos. Fractional money enters here or nowhere.",
  expected: {
    platform: "Maya",
    transaction_type: "Bills Payment",
    amount_php: 1850.75,
    reference_number: "9900112233445",
    account_number: "09281234567",
    fee_php: 37.02,
    postings: [
      { account: "cash", php: 1887.77 },
      { account: "Maya", php: -1850.75 },
      { account: "revenue", php: -37.02 },
    ],
  },
};
