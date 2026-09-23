/**
 * Fee calculation — the part of the model that IS operator-configurable.
 *
 * Ported from the live `calculateProfit` in
 * homelab/supabase/volumes/functions/main/_shared/transaction-processing.ts,
 * behaviour-for-behaviour, then moved to integer centavos. That function had
 * zero test coverage despite being the most financially sensitive code in the
 * system; the tests alongside this file pin every branch of it.
 *
 * Confirmed pricing: ceil(max(amount x 2%, PHP 5)). Expressed as
 * rate_bps = 200, minimum_minor = 500.
 */

import { type Minor, MINOR_PER_UNIT, ceilToUnit } from "./money.ts";
import type { FeeRule } from "./types.ts";

/**
 * Exact platform match wins over the "all" fallback.
 *
 * Without this ordering a generic "all" rule silently overrides platform
 * specific pricing, depending on nothing more than row order. The live code
 * already fixed this; the stale copy in src/lib never did, which is one of the
 * ways the two diverged.
 */
export function resolveFeeRule(
  txType: string,
  platform: string,
  rules: readonly FeeRule[]
): FeeRule | undefined {
  const exact = rules.find(
    (r) => r.is_active && r.transaction_type === txType && r.platform === platform
  );
  if (exact) return exact;
  return rules.find(
    (r) => r.is_active && r.transaction_type === txType && r.platform === "all"
  );
}

/**
 * Does this Cash Out amount LOOK like it already includes the fee?
 *
 * A customer who wants PHP 1,000 cash at a 2% fee sends 1,020, and the receipt
 * shows 1,020. Charging 2% of 1,020 bills the fee on the fee.
 *
 * This used to be applied silently inside calculateFee, and it was wrong often
 * enough to matter: at 2% the gross of ANY whole-peso base divides cleanly, so
 * every amount divisible by 51 tripped it — 510, 1020, 2040, 3060, 5100, which
 * are exactly the figures an agent handles all day. A review counted 387
 * whole-peso amounts under 20,000 that misfired, each charged about a peso
 * short. A genuine net cash out of 510 was billed 10 instead of 11.
 *
 * The information simply is not in the number. 1,020 is a legitimate net amount
 * and a legitimate gross amount, and no arithmetic distinguishes them. So this
 * no longer decides anything — it returns a SUGGESTION for the confirmation
 * gate to put to the operator, who is holding the receipt and can answer.
 * calculateFee only un-grosses when it is told to.
 *
 * The floor is derived from the rule rather than hardcoded. It was `> 250`,
 * which is minimum/rate for a 2% + PHP 5 rule specifically; set the minimum to
 * PHP 10 and the true crossover is 500 while the old code still used 250.
 * Below the crossover the minimum fee dominates anyway, and small amounts
 * divide cleanly by coincidence far too often.
 */
export function detectGrossAmount(
  txType: string,
  platform: string,
  amountMinor: Minor,
  rules: readonly FeeRule[]
): { likely: boolean; impliedBaseMinor: Minor; impliedFeeMinor: Minor } | null {
  if (txType !== "Cash Out") return null;

  const rule = resolveFeeRule(txType, platform, rules);
  if (!rule || rule.rate_bps <= 0) return null;

  const rate = rule.rate_bps / 10_000;
  const crossoverMinor = rule.minimum_minor / rate;

  const amountPesos = amountMinor / MINOR_PER_UNIT;
  const rawBase = amountPesos / (1 + rate);
  const isWholePeso = Math.abs(rawBase - Math.round(rawBase)) < 0.000001;

  if (!isWholePeso || rawBase * MINOR_PER_UNIT <= crossoverMinor) return null;

  const impliedBaseMinor = Math.round(rawBase * MINOR_PER_UNIT);
  return {
    likely: true,
    impliedBaseMinor,
    impliedFeeMinor: ceilToUnit(Math.max(impliedBaseMinor * rate, rule.minimum_minor)),
  };
}

/**
 * The operator's fee, in centavos.
 *
 * Returns 0 when no rule matches. That is deliberate and matches the live
 * behaviour: an unpriced transaction earns nothing rather than guessing.
 */
export interface FeeOptions {
  /**
   * The amount already includes the operator's fee, so charge on the implied
   * base rather than the printed figure. Set from an explicit answer at the
   * confirmation gate — never inferred. Defaults to false: a printed amount is
   * taken at face value.
   */
  amountIncludesFee?: boolean;
}

export function calculateFee(
  txType: string,
  platform: string,
  amountMinor: Minor,
  rules: readonly FeeRule[],
  opts: FeeOptions = {}
): Minor {
  const rule = resolveFeeRule(txType, platform, rules);
  if (!rule) return 0;

  const rate = rule.rate_bps / 10_000; // 200 bps -> 0.02
  const minimumMinor = rule.minimum_minor;

  let feeMinor = rate > 0 ? amountMinor * rate : 0;

  // Cash Out only, and only when the caller says so.
  //
  // Restricted to Cash Out because that is the one shape where the fee is
  // DEDUCTED from the printed amount. On the customer-pays-cash types the
  // customer hands over amount + fee, so the platform figure on the receipt is
  // the base by construction and there is nothing to un-gross.
  //
  // This used to run on a guess; see detectGrossAmount above for why the guess
  // was wrong on roughly one amount in fifty-one.
  if (opts.amountIncludesFee && txType === "Cash Out" && rate > 0) {
    feeMinor = (amountMinor / (1 + rate)) * rate;
  }

  // Cash In and Cash Out round UP to a whole peso — operators quote whole
  // pesos across the counter and do not hand back centavos.
  if (txType === "Cash In" || txType === "Cash Out") {
    return ceilToUnit(Math.max(feeMinor, minimumMinor));
  }

  // Everything else keeps centavo precision. Note the falsy check on the
  // minimum is intentional: a minimum of 0 means "no floor", not "floor at 0".
  if (minimumMinor) feeMinor = Math.max(feeMinor, minimumMinor);
  return Math.round(feeMinor);
}
