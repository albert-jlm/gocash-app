/**
 * PROBE: the legacy "PayMaya" brand name, recovered by the platform fallback.
 * Third platform, third fallback path, so all three are exercised.
 *
 * WHY IT BREAKS: platform aliasing is a moving target. Maya renamed from
 * PayMaya, and older app builds, cached receipts and screenshots forwarded
 * from a customer still carry the old name. `detectPlatform` handles this one
 * — it checks `t.includes("maya") || t.includes("paymaya")` — but the alias
 * list is a hardcoded literal in the deployed source, so every future rename
 * or new platform is a silent "Unknown" until someone edits that function.
 *
 * "Unknown" is not benign: `buildPostings` will happily create a posting
 * against a platform literally named "Unknown", because nothing validates the
 * platform against the operator's `operator_platforms` rows. The entry
 * balances, and the money lands in a wallet that does not exist. (The legacy
 * `computeWalletDeltas` at least mapped Unknown to GCash; the rebuilt path has
 * no such mapping, so this is a new gap rather than an inherited one.)
 *
 * This fixture passes. It is here so that the day the alias list goes stale,
 * something goes red.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "paymaya-alias-platform-fallback",
  probe: 'Legacy "PayMaya" branding resolved to Maya by the detectPlatform alias list.',
  why: "The alias list is a hardcoded literal; a rename or a new platform silently yields 'Unknown', and nothing validates the platform before it becomes a posting.",
  expected: {
    platform: "Maya",
    transaction_type: "Telco Load",
    amount_php: 300,
    reference_number: "5512348899020",
    account_number: "09171234567",
    fee_php: 6,
    postings: [
      { account: "cash", php: 306 },
      { account: "Maya", php: -300 },
      { account: "revenue", php: -6 },
    ],
  },
};
