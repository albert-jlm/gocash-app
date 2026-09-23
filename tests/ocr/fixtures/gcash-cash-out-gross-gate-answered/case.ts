/**
 * PROBE: the required "Cash Out whose printed amount already includes the
 * fee", WITH the operator's answer supplied at the confirmation gate.
 *
 * WHY IT BREAKS: the information simply is not on the receipt. A customer who
 * wants PHP 1,000 in cash sends 1,020 to cover the 2% fee, and the screenshot
 * says 1,020 and nothing else. 1,020 is a perfectly legitimate NET amount too.
 * No amount of OCR accuracy can separate the two cases, because the difference
 * was never printed.
 *
 * fees.ts used to guess, and the guess was wrong roughly one Cash Out in
 * fifty-one — every amount divisible by 51, which is 510, 1020, 2040, 3060,
 * 5100, exactly the figures an agent handles all day. `detectGrossAmount` now
 * returns a SUGGESTION and `calculateFee` only un-grosses when explicitly told
 * to. Here it is told to: gate.amountIncludesFee = true, so the fee is charged
 * on the implied PHP 1,000 base and the customer gets a clean 1,000 in cash.
 *
 * THE FINDING IS NOT IN THIS FIXTURE'S RESULT — it passes. The finding is that
 * the OCR response carries NO FIELD that could feed the gate. Nothing in
 * raw_text, platform, transaction_type, amount, reference_number,
 * account_number or transaction_date says "this figure is gross". The gate
 * answer has to come from a human every time, and
 * maya-cash-out-gross-gate-missed shows what happens on the day it doesn't.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "gcash-cash-out-gross-gate-answered",
  probe: "Gross Cash Out (1,020 = 1,000 + fee) with the confirmation gate answered.",
  why: "Gross vs net is not printed on the receipt; only the operator knows. The OCR response has no field for it.",
  gate: { amountIncludesFee: true },
  expected: {
    platform: "GCash",
    transaction_type: "Cash Out",
    amount_php: 1020,
    reference_number: "1029384756131",
    account_number: "09005208780",
    fee_php: 20,
    postings: [
      { account: "GCash", php: 1020 },
      { account: "cash", php: -1000 },
      { account: "revenue", php: -20 },
    ],
  },
};
