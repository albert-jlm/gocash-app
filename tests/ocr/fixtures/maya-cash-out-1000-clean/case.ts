/**
 * PROBE: the Cash Out direction and its fee asymmetry, on a clean receipt.
 *
 * WHY IT MATTERS: Cash Out is the one type where the fee is DEDUCTED from the
 * printed amount rather than added on top. A PHP 1,000 cash out pays the
 * customer 980 and keeps 20. Cash In on the same amount would move 1,020 the
 * other way. The two are mirror images and a type misread does not just get a
 * label wrong, it swings the drawer by twice the transaction — which is what
 * maribank-bare-receipt-defaults-to-cash-in demonstrates.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "maya-cash-out-1000-clean",
  probe: "Happy path Cash Out: fee deducted, not added; customer receives 980.",
  why: "Control for the mirrored direction. Pins the fee-deduction asymmetry.",
  expected: {
    platform: "Maya",
    transaction_type: "Cash Out",
    amount_php: 1000,
    reference_number: "5512348899001",
    account_number: "09189876543",
    fee_php: 20,
    postings: [
      { account: "Maya", php: 1000 },
      { account: "cash", php: -980 },
      { account: "revenue", php: -20 },
    ],
  },
};
