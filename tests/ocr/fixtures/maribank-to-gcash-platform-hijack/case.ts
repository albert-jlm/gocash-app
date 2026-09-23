/**
 * PROBE: a cross-wallet transfer. The operator pays OUT of MariBank INTO the
 * customer's GCash. Both platform names appear in raw_text, and the model
 * returned "Unknown", so `detectPlatform` decides.
 *
 * WHY IT BREAKS: `detectPlatform` is a fixed-order keyword scan and GCash is
 * tested first:
 *
 *     if (t.includes("gcash") || t.includes("g-cash")) return "GCash";
 *     if (t.includes("maribank") || t.includes("mari bank")) return "MariBank";
 *
 * "MariBank" is on line 1 and "To GCash" is on line 5, and it does not matter:
 * the scan is ordered by platform, not by position, and it has no notion of
 * which wallet is the SOURCE. Any receipt that so much as mentions GCash reads
 * as GCash. Cross-wallet transfers are routine for an operator running three
 * wallets, and GCash is the one every Filipino customer has, so it is the
 * platform most likely to appear as the DESTINATION on someone else's receipt.
 *
 * KNOWN FAILURE (balanced_wrong). The entry balances and every sign is right.
 * The wrong wallet is drained: GCash goes down 1,000 and MariBank is never
 * touched. Both wallet balances are then wrong by 1,000 in opposite
 * directions, the drawer is right, revenue is right, and the nightly
 * reconciliation will show two platforms off by equal and opposite amounts
 * with no indication of why.
 *
 * Note this is also the case where a stricter fix is tempting and wrong:
 * preferring the FIRST platform mentioned would fix this receipt and break
 * every GCash receipt that says "GCash" in a footer.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "maribank-to-gcash-platform-hijack",
  probe: "MariBank receipt naming GCash as the destination; detectPlatform returns GCash.",
  why: "detectPlatform scans in platform order, not text order, and has no source/destination notion.",
  expected: {
    platform: "MariBank",
    transaction_type: "Cash In",
    amount_php: 1000,
    reference_number: "MB-5501123456790",
    account_number: "09173334444",
    fee_php: 20,
    postings: [
      { account: "cash", php: 1020 },
      { account: "MariBank", php: -1000 },
      { account: "revenue", php: -20 },
    ],
  },
  known_failure: {
    kind: "balanced_wrong",
    why:
      "detectPlatform tests GCash before MariBank, so the destination wallet wins. " +
      "GCash is debited 1,000 and MariBank is never touched. Two wallet balances wrong " +
      "by equal and opposite amounts, in a balanced entry.",
    actual: {
      platform: "GCash",
      postings: [
        { account: "cash", php: 1020 },
        { account: "GCash", php: -1000 },
        { account: "revenue", php: -20 },
      ],
    },
  },
};
