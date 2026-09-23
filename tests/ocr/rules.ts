/**
 * The fee rules every fixture is priced against.
 *
 * These are not invented. They are the defaults a new operator is provisioned
 * with in `supabase/migrations/20260924000005_provision_operator.sql` §6:
 * one rule per transaction type, platform "all", rate_bps 200 (2.00%),
 * minimum_minor 500 (PHP 5.00).
 *
 * Holding them constant across the fixture set is deliberate. The harness is
 * measuring the OCR read, not the pricing — fees.ts already has its own tests,
 * including a differential check against the live implementation. If pricing
 * varied per fixture, an accuracy regression and a pricing change would be
 * indistinguishable in the report.
 *
 * NOTE the Profit Remittance row: the seed gives it a 2% / PHP 5 rule even
 * though `profitRemittance()` in postings.ts takes no fee and ignores one.
 * That is copied faithfully rather than "cleaned up" — see the findings in
 * tests/ocr/README.md.
 */

import type { FeeRule } from "../../supabase/functions/_core/types.ts";
import { TRANSACTION_TYPES } from "../../supabase/functions/_core/types.ts";

export const DEFAULT_FEE_RULES: readonly FeeRule[] = TRANSACTION_TYPES.map((t) => ({
  transaction_type: t,
  platform: "all",
  rate_bps: 200,
  minimum_minor: 500,
  is_active: true,
}));
