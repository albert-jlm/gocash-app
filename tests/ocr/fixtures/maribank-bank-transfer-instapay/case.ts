/**
 * PROBE: Bank Transfer on MariBank, and a receipt with NO customer mobile
 * number anywhere on it.
 *
 * WHY IT MATTERS: two things at once. (1) Bank Transfer is one of the four
 * types that was broken live — the old rule posted a zero cash leg and never
 * booked the fee, so the entire principal vanished. (2) An absent account
 * number is the correct answer here, not a failure, and the harness has to
 * score "correctly returned null" as a HIT. A report that scored nulls as
 * misses would push someone to make `extractAccountNumber` more aggressive,
 * which is precisely how it would start returning the operator's own number.
 *
 * Also note the alphanumeric reference (MB...) — the regex-shaped assumption
 * that references are 9-13 digits does not hold across platforms.
 *
 * HISTORY: this fixture was first written with the date-prefixed reference
 * "MB2409240001123", which is the shape MariBank actually uses. The runner
 * failed it immediately: extractAccountNumber found "09945982959" inside the
 * reference and returned it as a customer mobile number. The reference here
 * was changed to keep this fixture's probe clean, and that defect was given
 * its own fixture — reference-digits-read-as-mobile-number. Worth recording
 * that it was found by ACCIDENT, in a fixture written to test something else,
 * on the first realistic reference number tried.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "maribank-bank-transfer-instapay",
  probe: "Bank Transfer, MariBank, alphanumeric reference, no mobile number present.",
  why: "A correctly-absent account number must score as a hit, not a miss.",
  expected: {
    platform: "MariBank",
    transaction_type: "Bank Transfer",
    amount_php: 2500,
    reference_number: "MB-5501123456781",
    account_number: null,
    fee_php: 50,
    postings: [
      { account: "cash", php: 2550 },
      { account: "MariBank", php: -2500 },
      { account: "revenue", php: -50 },
    ],
  },
};
