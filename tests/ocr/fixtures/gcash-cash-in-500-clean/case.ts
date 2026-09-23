/**
 * PROBE: the baseline. Every field present, every field correct, the most
 * common transaction an operator does all day.
 *
 * WHY IT MATTERS: this is the control. If it ever fails, the failure is in the
 * harness or in the fee/posting code, not in the OCR read — which is exactly
 * the distinction the accuracy number has to be able to make. It also pins the
 * Cash In direction that the whole rebuild turns on: the customer hands over
 * CASH (drawer UP 510) and receives e-money (wallet DOWN 500). Four separate
 * documents in this repo had that backwards.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "gcash-cash-in-500-clean",
  probe: "Happy path: all seven fields read correctly from a clean GCash receipt.",
  why: "Control case. Isolates harness/pricing faults from genuine OCR misreads.",
  expected: {
    platform: "GCash",
    transaction_type: "Cash In",
    amount_php: 500,
    reference_number: "1029384756123",
    account_number: "09171234567",
    fee_php: 10,
    postings: [
      { account: "cash", php: 510 },
      { account: "GCash", php: -500 },
      { account: "revenue", php: -10 },
    ],
  },
};
