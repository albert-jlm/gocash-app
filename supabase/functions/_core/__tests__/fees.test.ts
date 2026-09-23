/**
 * Fee tests, including a differential check against the live implementation.
 *
 * `calculateProfit` has been computing real money in production with zero test
 * coverage. Before changing anything about it, these tests prove the centavo
 * port produces identical results to the float version it replaces.
 */

import { describe, it, expect } from "vitest";
import { calculateFee, resolveFeeRule } from "../fees.ts";
import { toMinor } from "../money.ts";
import type { FeeRule } from "../types.ts";

// ---------------------------------------------------------------------------
// The live implementation, copied verbatim from
// homelab/supabase/volumes/functions/main/_shared/transaction-processing.ts
// as a reference oracle. Do not "clean this up" — its value is being untouched.
// ---------------------------------------------------------------------------

interface LegacyRule {
  transaction_type: string;
  platform: string;
  profit_rate: number | null;
  profit_minimum: number | null;
  is_active: boolean;
}

function legacyResolve(txType: string, platform: string, rules: LegacyRule[]) {
  const exact = rules.find(
    (r) => r.is_active && r.transaction_type === txType && r.platform === platform
  );
  if (exact) return exact;
  return rules.find(
    (r) => r.is_active && r.transaction_type === txType && r.platform === "all"
  );
}

function legacyCalculateProfit(
  txType: string,
  platform: string,
  amount: number,
  rules: LegacyRule[]
): number {
  const rule = legacyResolve(txType, platform, rules);
  if (!rule || (rule.profit_rate === null && rule.profit_minimum === null)) return 0;

  const ratePercent = rule.profit_rate ?? 0;
  const minimum = rule.profit_minimum ?? 0;
  const rate = ratePercent / 100;

  let profit = rate > 0 ? amount * rate : 0;

  if (txType === "Cash Out" && rate > 0) {
    const rawBase = amount / (1 + rate);
    const isGrossAmountWithIncludedFee =
      rawBase > 250 && Math.abs(rawBase - Math.round(rawBase)) < 0.000001;
    if (isGrossAmountWithIncludedFee) profit = rawBase * rate;
  }

  if (txType === "Cash In" || txType === "Cash Out") {
    return Math.ceil(Math.max(profit, minimum));
  }

  if (minimum) profit = Math.max(profit, minimum);
  return Math.round(profit * 100) / 100;
}

// ---------------------------------------------------------------------------
// Fixtures — the confirmed pricing: ceil(max(2%, PHP 5))
// ---------------------------------------------------------------------------

const TYPES = [
  "Cash In",
  "Cash Out",
  "Telco Load",
  "Bills Payment",
  "Bank Transfer",
  "Profit Remittance",
];

const LEGACY_RULES: LegacyRule[] = TYPES.map((t) => ({
  transaction_type: t,
  platform: "all",
  profit_rate: 2,
  profit_minimum: 5,
  is_active: true,
}));

const RULES: FeeRule[] = TYPES.map((t) => ({
  transaction_type: t,
  platform: "all",
  rate_bps: 200,
  minimum_minor: 500,
  is_active: true,
}));

// ---------------------------------------------------------------------------
// Differential: the port must not change any answer
// ---------------------------------------------------------------------------

describe("centavo port matches the live float implementation", () => {
  // Deliberately includes the gross-fee cases (1020 = 1000 x 1.02), the
  // minimum-fee band, and amounts that produce fractional centavos.
  const amounts = [
    0, 1, 5, 20, 49, 50, 99, 100, 150, 249, 250, 251, 255, 300, 333, 500, 510,
    765, 999, 1000, 1020, 1530, 1850, 2000, 2040, 2550, 5000, 5100, 9999,
    12345, 50000, 99999,
  ];

  for (const txType of TYPES) {
    it(`${txType}: identical across ${amounts.length} amounts`, () => {
      for (const amount of amounts) {
        const legacy = legacyCalculateProfit(txType, "GCash", amount, LEGACY_RULES);
        const ported = calculateFee(txType, "GCash", toMinor(amount), RULES);
        expect(
          ported,
          `${txType} at PHP ${amount}: legacy ${legacy}, ported ${ported / 100}`
        ).toBe(toMinor(legacy));
      }
    });
  }

  it("agrees on fractional peso amounts too", () => {
    for (const amount of [12.5, 99.99, 333.33, 1234.56]) {
      for (const txType of TYPES) {
        const legacy = legacyCalculateProfit(txType, "GCash", amount, LEGACY_RULES);
        const ported = calculateFee(txType, "GCash", toMinor(amount), RULES);
        expect(ported, `${txType} at PHP ${amount}`).toBe(toMinor(legacy));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The pricing itself
// ---------------------------------------------------------------------------

describe("ceil(max(2%, PHP 5))", () => {
  it("the PHP 5 minimum binds below PHP 250", () => {
    expect(calculateFee("Cash In", "GCash", toMinor(100), RULES)).toBe(500);
    expect(calculateFee("Cash In", "GCash", toMinor(249), RULES)).toBe(500);
  });

  it("2% takes over above PHP 250", () => {
    expect(calculateFee("Cash In", "GCash", toMinor(500), RULES)).toBe(1000);
    expect(calculateFee("Cash In", "GCash", toMinor(1000), RULES)).toBe(2000);
  });

  it("PHP 250 is exactly the crossover: 2% of 250 = 5", () => {
    expect(calculateFee("Cash In", "GCash", toMinor(250), RULES)).toBe(500);
  });

  it("rounds UP to a whole peso on Cash In / Cash Out", () => {
    // 2% of 333 = 6.66 -> 7
    expect(calculateFee("Cash In", "GCash", toMinor(333), RULES)).toBe(700);
  });

  it("keeps centavo precision on the other types", () => {
    // 2% of 333 = 6.66, no ceil for Telco Load
    expect(calculateFee("Telco Load", "GCash", toMinor(333), RULES)).toBe(666);
  });
});

describe("Cash Out receipts that already include the fee", () => {
  it("takes the fee from the base, not the gross, when it divides cleanly", () => {
    // A PHP 1,000 cash out shown as 1,020. Fee is 20, not 20.40.
    expect(calculateFee("Cash Out", "GCash", toMinor(1020), RULES)).toBe(2000);
  });

  it("treats a non-dividing amount as net", () => {
    // 1000 / 1.02 = 980.39... not a whole peso, so charge 2% of 1000 = 20
    expect(calculateFee("Cash Out", "GCash", toMinor(1000), RULES)).toBe(2000);
  });

  it("does not apply below the PHP 250 floor", () => {
    // 255 / 1.02 = 250 exactly, but 250 is not > 250, so the heuristic is off
    expect(calculateFee("Cash Out", "GCash", toMinor(255), RULES)).toBe(600);
  });

  it("applies only to Cash Out", () => {
    // same gross-looking amount, but Cash In never second-guesses the number
    expect(calculateFee("Cash In", "GCash", toMinor(1020), RULES)).toBe(2100);
  });
});

// ---------------------------------------------------------------------------
// Rule resolution
// ---------------------------------------------------------------------------

describe("rule resolution", () => {
  const mixed: FeeRule[] = [
    { transaction_type: "Cash In", platform: "all", rate_bps: 200, minimum_minor: 500, is_active: true },
    { transaction_type: "Cash In", platform: "Maya", rate_bps: 300, minimum_minor: 1000, is_active: true },
  ];

  it("an exact platform match beats the 'all' fallback regardless of row order", () => {
    // 3% of 1000 = 30, not 2% = 20
    expect(calculateFee("Cash In", "Maya", toMinor(1000), mixed)).toBe(3000);
  });

  it("falls back to 'all' for a platform with no specific rule", () => {
    expect(calculateFee("Cash In", "GCash", toMinor(1000), mixed)).toBe(2000);
  });

  it("ignores inactive rules", () => {
    const inactive: FeeRule[] = [{ ...mixed[1], is_active: false }];
    expect(resolveFeeRule("Cash In", "Maya", inactive)).toBeUndefined();
  });

  it("earns nothing when no rule matches, rather than guessing", () => {
    expect(calculateFee("Cash In", "GCash", toMinor(1000), [])).toBe(0);
  });
});
