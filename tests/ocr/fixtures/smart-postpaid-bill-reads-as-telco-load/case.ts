/**
 * PROBE: a telco's name on a BILLS PAYMENT receipt. `detectType` tests the
 * telco keyword list before the bills list.
 *
 * WHY IT BREAKS: the ordering inside `detectType` is
 *
 *     ... Telco Load: "globe" | "smart" | "dito" | "tnt" | " load" ...
 *     ... Bills Payment: "bills" | "bill payment" | "biller" ...
 *
 * A Smart POSTPAID bill contains "smart" and never contains "bills", so it is
 * classified as a Telco Load before the bills branch is reached. Every postpaid
 * bill from Globe, Smart, DITO or TNT hits this — and postpaid bills are a
 * large, high-value share of an agent's bills volume, far larger than the
 * utility bills the branch was written for.
 *
 * KNOWN FAILURE (fields_only). The ledger is IDENTICAL today, and that is the
 * trap. `telcoLoad` and `billsPayment` are the same shape, and both types
 * currently resolve to the same platform:"all" 2% / PHP 5 rule, so the postings
 * match to the centavo. The misread is completely invisible in the books.
 *
 * It stops being invisible the moment pricing differs by type, which
 * `fee_rules` is explicitly built to allow — one row per transaction type, per
 * platform, with its own rate and minimum. An operator who prices load at a
 * flat PHP 5 and bills at 2% starts mispricing every postpaid bill the day
 * they set that up, with nothing in the ledger to show for it. Per-type
 * reporting is wrong from today.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "smart-postpaid-bill-reads-as-telco-load",
  probe: "Bills Payment for a Smart postpaid bill, classified as Telco Load by keyword order.",
  why: "detectType tests telco brand names before the bills branch; postpaid bills never say 'bills'.",
  expected: {
    platform: "Maya",
    transaction_type: "Bills Payment",
    amount_php: 1299,
    reference_number: "9900112233446",
    account_number: null,
    fee_php: 25.98,
    postings: [
      { account: "cash", php: 1324.98 },
      { account: "Maya", php: -1299 },
      { account: "revenue", php: -25.98 },
    ],
  },
  known_failure: {
    kind: "fields_only",
    why:
      "Classified Telco Load instead of Bills Payment. The postings are identical TODAY " +
      "because both types share one platform:'all' rule and the same posting shape — so " +
      "the misread is invisible in the ledger and becomes real money the moment fee_rules " +
      "prices the two types differently, which is what fee_rules exists to allow.",
    actual: { transaction_type: "Telco Load" },
  },
};
