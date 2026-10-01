/**
 * Resolving the fee rule in force at a point in time.
 *
 * Extracted from `_confirm_transaction.ts` when `create-transaction` needed the
 * same lookup. A second copy would have been AUDITS.md #5 finding 4 again — the
 * defect where the same money arithmetic lived in two files and drifted.
 */

import type { FeeRule } from "../../_core/types.ts";

/**
 * The rule for (type, platform) as at `at`.
 *
 * Tries the exact platform first, then the 'all' fallback, so a generic rule can
 * never silently override platform-specific pricing. Returns null when neither
 * exists — the caller decides whether that is a 422 or a zero fee, because the
 * answer differs: at the gate it must stop the posting, in a preview it must
 * only warn.
 *
 * `at` matters. fee_rules are effective-dated precisely so that amending an old
 * transaction reprices it at the rate that applied ON THE DAY, not today's.
 */
export async function resolveRuleAt(
  // deno-lint-ignore no-explicit-any
  admin: any,
  operatorId: string,
  txType: string,
  platform: string,
  at: string,
): Promise<FeeRule | null> {
  for (const candidate of [platform, "all"]) {
    const { data } = await admin.rpc("fee_rule_at", {
      p_operator_id: operatorId,
      p_transaction_type: txType,
      p_platform: candidate,
      p_at: at,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.id) {
      return {
        transaction_type: row.transaction_type,
        platform: row.platform,
        rate_bps: Number(row.rate_bps),
        minimum_minor: Number(row.minimum_minor),
        is_active: true,
      };
    }
  }
  return null;
}
