/**
 * UPDATE 2026-11-18: The mobile-number regex is anchored, so digits inside a reference no longer match.
 * The analysis below describes the behaviour before that change.
 *
 * PROBE: a receipt with NO mobile number on it at all, and a date-prefixed
 * reference number. The model correctly returns account_number: null, so the
 * regex fallback runs.
 *
 * WHY IT BREAKS: `extractAccountNumber` scans the whole transcript with
 *
 *     /(?:\+639|09)\d{9}/g
 *
 * which has no word boundaries and no context. "MB2409240001987" — MB, then
 * 240924 as YYMMDD, then a sequence — contains "09022362733" starting at the
 * "09" of the date. Eleven digits, starts with 09, not on the blacklist, so it
 * is returned as the customer's mobile number.
 *
 * This is not a contrived string. Date-prefixed references are the standard
 * shape for Philippine bank and e-wallet references, and any reference
 * generated in September (month 09) of any year, or on the 9th of any month
 * under a DDMM layout, puts an "09" in the middle of a long digit run. The
 * fallback fires on a large, predictable, recurring fraction of receipts —
 * seasonally, which is the worst way for a bug to arrive.
 *
 * KNOWN FAILURE (fields_only). The ledger entry is correct. A fabricated
 * mobile number is written to the transaction, and unlike a null it looks like
 * real data: it will appear in customer history, it can be dialled, and it can
 * collide with a real customer's number. The fallback is at its most
 * dangerous exactly when it should decline — on a receipt that has no mobile
 * number to find.
 *
 * Guarding it needs word boundaries and a length check, i.e. a change to
 * `extractAccountNumber` in transaction-processing.ts, which this harness does
 * not own.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "reference-digits-read-as-mobile-number",
  probe: "No mobile number on the receipt; the regex finds one inside the reference number.",
  why: "An unanchored /(?:\\+639|09)\\d{9}/ matches the '09' of a date-prefixed reference. Fabricates customer data from nothing.",
  expected: {
    platform: "MariBank",
    transaction_type: "Bank Transfer",
    amount_php: 3000,
    reference_number: "MB2409240001987",
    account_number: null,
    fee_php: 60,
    postings: [
      { account: "cash", php: 3060 },
      { account: "MariBank", php: -3000 },
      { account: "revenue", php: -60 },
    ],
  },
};
