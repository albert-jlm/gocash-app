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
 * Detects a Cash Out receipt whose printed amount ALREADY includes the fee.
 *
 * If a customer cashes out PHP 1,000 and the operator's cut is 2%, some
 * receipts show 1,020. Charging 2% of 1,020 would bill the fee twice. When the
 * amount divides cleanly back to a whole-peso base above PHP 250, we treat it
 * as gross and take the fee from the base instead.
 *
 * This is a heuristic, so it runs in floating point on purpose — it is pattern
 * detection, not a money value. Only its OUTPUT becomes money, and that is
 * rounded to exact centavos by the caller.
 *
 * The PHP 250 floor exists because below it the minimum fee dominates anyway,
 * and small amounts divide cleanly by coincidence far too often.
 */
function grossBasePesos(amountPesos: number, rate: number): number | null {
  const rawBase = amountPesos / (1 + rate);
  const isWholePeso = Math.abs(rawBase - Math.round(rawBase)) < 0.000001;
  return rawBase > 250 && isWholePeso ? rawBase : null;
}

/**
 * The operator's fee, in centavos.
 *
 * Returns 0 when no rule matches. That is deliberate and matches the live
 * behaviour: an unpriced transaction earns nothing rather than guessing.
 */
export function calculateFee(
  txType: string,
  platform: string,
  amountMinor: Minor,
  rules: readonly FeeRule[]
): Minor {
  const rule = resolveFeeRule(txType, platform, rules);
  if (!rule) return 0;

  const rate = rule.rate_bps / 10_000; // 200 bps -> 0.02
  const minimumMinor = rule.minimum_minor;

  let feeMinor = rate > 0 ? amountMinor * rate : 0;

  if (txType === "Cash Out" && rate > 0) {
    const base = grossBasePesos(amountMinor / MINOR_PER_UNIT, rate);
    if (base !== null) feeMinor = base * rate * MINOR_PER_UNIT;
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
