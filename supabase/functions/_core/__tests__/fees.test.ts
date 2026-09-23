/**
 * Fee tests, including a differential check against the live implementation.
 *
 * `calculateProfit` has been computing real money in production with zero test
 * coverage. Before changing anything about it, these tests prove the centavo
 * port produces identical results to the float version it replaces.
 */

import { describe, it, expect } from "vitest";
import { calculateFee, resolveFeeRule, detectGrossAmount } from "../fees.ts";
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
// Differential against the live implementation.
//
// An earlier version of this file claimed the port was "provably faithful" on
// the strength of 33 whole-peso amounts and four fractional ones. That was too
// weak a sweep: a review scanning every centavo found 167 divergences per
// non-Cash-In/Out type, the first at PHP 250.75. The claim was wrong.
//
// There are exactly TWO classes of divergence, both deliberate. These tests
// assert that every difference falls into one of them — so a NEW, unexplained
// divergence fails the build.
// ---------------------------------------------------------------------------

describe("differential vs the live implementation", () => {
  const CENTAVO_SWEEP: number[] = [];
  for (let c = 1; c <= 60_000; c++) CENTAVO_SWEEP.push(c); // PHP 0.01 .. 600.00

  const WHOLE_PESO_SWEEP: number[] = [];
  for (let p = 1; p <= 20_000; p++) WHOLE_PESO_SWEEP.push(p * 100);

  /**
   * DEVIATION 1 — rounding space.
   *
   * For types that keep centavo precision, the legacy code rounds in PESO
   * space (`Math.round(profit * 100) / 100`) and the port rounds in CENTAVO
   * space. At PHP 250.75, 2% is 5.015: in pesos `5.015 * 100` is
   * 501.49999999999994 and rounds DOWN to 501; in centavos `25075 * 0.02` is
   * exactly 501.5 and rounds UP to 502.
   *
   * The port is the more correct of the two — the legacy answer is an artefact
   * of float representation, not a pricing decision — and it can only ever
   * differ by one centavo, always in the customer's disfavour by that centavo.
   * Accepted deliberately.
   */
  it("deviation 1: differs from legacy by at most 1 centavo, and only on centavo-precision types", () => {
    const centavoTypes = TYPES.filter((t) => t !== "Cash In" && t !== "Cash Out");
    let diffs = 0;
    for (const txType of centavoTypes) {
      for (const minor of CENTAVO_SWEEP) {
        const legacy = toMinor(legacyCalculateProfit(txType, "GCash", minor / 100, LEGACY_RULES));
        const ported = calculateFee(txType, "GCash", minor, RULES);
        if (legacy !== ported) {
          diffs++;
          expect(
            Math.abs(ported - legacy),
            `${txType} at ${minor} centavos: legacy ${legacy}, ported ${ported}`
          ).toBe(1);
        }
      }
    }
    // Divergences exist and are bounded. If this ever reaches zero the legacy
    // oracle has been changed and this test is no longer measuring anything.
    expect(diffs).toBeGreaterThan(0);
  });

  it("deviation 1 does not affect whole-peso amounts, which is the common case", () => {
    for (const txType of TYPES) {
      for (const minor of WHOLE_PESO_SWEEP) {
        if (txType === "Cash Out") continue; // deviation 2, covered below
        const legacy = toMinor(legacyCalculateProfit(txType, "GCash", minor / 100, LEGACY_RULES));
        expect(calculateFee(txType, "GCash", minor, RULES), `${txType} at PHP ${minor / 100}`)
          .toBe(legacy);
      }
    }
  });

  /**
   * DEVIATION 2 — the gross-amount heuristic no longer fires on a guess.
   *
   * Legacy silently un-grossed any Cash Out whose amount divided to a whole
   * peso above 250. At 2% that is every amount divisible by 51, so 510, 1020,
   * 2040, 3060 and 5100 — ordinary figures — were each charged about a peso
   * short. The port charges the printed amount unless explicitly told the fee
   * is included.
   */
  it("deviation 2: Cash Out matches legacy except where legacy guessed", () => {
    const guessed: number[] = [];
    for (const minor of WHOLE_PESO_SWEEP) {
      const legacy = toMinor(legacyCalculateProfit("Cash Out", "GCash", minor / 100, LEGACY_RULES));
      const ported = calculateFee("Cash Out", "GCash", minor, RULES);
      if (legacy !== ported) {
        guessed.push(minor / 100);
        // Legacy always charged LESS, because it took the fee off a smaller base.
        expect(legacy, `PHP ${minor / 100}`).toBeLessThan(ported);
      }
    }
    // Every divergence is an amount divisible by 51 — the gross of a whole peso.
    for (const amount of guessed) {
      expect(amount % 51, `PHP ${amount} diverged but is not a multiple of 51`).toBe(0);
    }
    expect(guessed).toContain(510);
    expect(guessed).toContain(1020);
    expect(guessed).toContain(5100);
    expect(guessed.length).toBeGreaterThan(300);
  });

  it("the un-grossing is still available, but only when asked for", () => {
    // A PHP 1,000 cash out printed as 1,020: charge on the 1,000 base.
    expect(calculateFee("Cash Out", "GCash", toMinor(1020), RULES)).toBe(2100);
    expect(calculateFee("Cash Out", "GCash", toMinor(1020), RULES, { amountIncludesFee: true }))
      .toBe(2000);
  });

  it("detectGrossAmount suggests rather than decides, and derives its own floor", () => {
    const hit = detectGrossAmount("Cash Out", "GCash", toMinor(1020), RULES);
    expect(hit?.likely).toBe(true);
    expect(hit?.impliedBaseMinor).toBe(toMinor(1000));
    expect(hit?.impliedFeeMinor).toBe(2000);

    // 255 / 1.02 = 250 exactly, but 250 is the crossover (min 5 / rate 2%),
    // not above it, so it is not flagged.
    expect(detectGrossAmount("Cash Out", "GCash", toMinor(255), RULES)).toBeNull();

    // Raise the minimum to PHP 10 and the crossover moves to 500. The old
    // hardcoded `> 250` would still have fired here.
    const richer = RULES.map((r) => ({ ...r, minimum_minor: 1000 }));
    expect(detectGrossAmount("Cash Out", "GCash", toMinor(408), richer)).toBeNull();

    expect(detectGrossAmount("Cash In", "GCash", toMinor(1020), RULES)).toBeNull();
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
  it("charges the printed amount by default — no guessing", () => {
    // 1,020 is a perfectly ordinary net cash out. Legacy silently assumed it
    // was a grossed-up 1,000 and charged 20; that under-charged every genuine
    // cash out of 510, 1020, 2040, 5100 and 383 other amounts under 20,000.
    expect(calculateFee("Cash Out", "GCash", toMinor(1020), RULES)).toBe(2100);
  });

  it("un-grosses only when told the fee is included", () => {
    expect(calculateFee("Cash Out", "GCash", toMinor(1020), RULES, { amountIncludesFee: true }))
      .toBe(2000);
  });

  it("the flag is a no-op on types where it makes no sense", () => {
    const withFlag = calculateFee("Cash In", "GCash", toMinor(1020), RULES, { amountIncludesFee: true });
    const without  = calculateFee("Cash In", "GCash", toMinor(1020), RULES);
    expect(withFlag).toBe(without);
  });

  it("still respects the minimum after un-grossing", () => {
    // A tiny gross amount must not un-gross its way below the PHP 5 floor.
    expect(calculateFee("Cash Out", "GCash", toMinor(102), RULES, { amountIncludesFee: true }))
      .toBe(500);
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
