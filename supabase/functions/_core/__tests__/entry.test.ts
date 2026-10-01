/**
 * quoteEntry — the one place a transaction is priced and turned into legs.
 *
 * WHAT THESE TESTS ARE FOR
 * The entry form shows the operator a fee and a set of balance changes BEFORE
 * they save. If that preview can differ from what the gate posts, the review
 * step is worse than useless: it teaches the operator to trust a figure that is
 * not the one being written. These tests exist to make that a property of the
 * code rather than a promise in a comment — there is one implementation, and
 * these assert what it does.
 */

import { describe, it, expect } from "vitest";
import { quoteEntry } from "../entry.ts";
import { toMinor } from "../money.ts";
import { TRANSACTION_TYPES } from "../types.ts";
import type { FeeRule, TransactionType } from "../types.ts";

/** The confirmed pricing: ceil(max(amount x 2%, PHP 5)). */
const RULES: FeeRule[] = TRANSACTION_TYPES.map((t) => ({
  transaction_type: t,
  platform: "all",
  rate_bps: 200,
  minimum_minor: 500,
  is_active: true,
}));

function quote(
  type: TransactionType,
  pesos: number,
  opts: { platform?: string; amountIncludesFee?: boolean; rules?: FeeRule[] } = {},
) {
  return quoteEntry(
    {
      transactionType: type,
      platform: opts.platform ?? "GCash",
      amountMinor: toMinor(pesos),
      amountIncludesFee: opts.amountIncludesFee,
    },
    opts.rules ?? RULES,
  );
}

/** Signed centavos on one account, summed — never `find`, which hides a second leg. */
function leg(postings: ReturnType<typeof quote>["postings"], account: string): number {
  return postings
    .filter((p) => (p.account.kind === "platform" ? p.account.platform : p.account.kind) === account)
    .reduce((sum, p) => sum + p.amount, 0);
}

describe("quoteEntry", () => {
  // -------------------------------------------------------------------------
  // The invariant the whole ledger rests on. Asserted across every type and a
  // spread of amounts rather than on a handful of examples, because the defect
  // this replaced — four of six types destroying money — was present in
  // production for months precisely because nothing said the books must
  // balance.
  // -------------------------------------------------------------------------
  const AMOUNTS = [1, 5, 20, 49.5, 100, 250, 251, 510, 1020, 1850, 99999.99];

  /**
   * A Cash Out below the PHP 5 fee floor pays out nothing or less than nothing,
   * and is refused — see the dedicated assertion at the bottom. Excluded from
   * the sweeps so they test the balance invariant rather than rediscovering
   * that refusal six times.
   */
  const isRefused = (type: TransactionType, pesos: number) =>
    type === "Cash Out" && pesos <= 5;

  it("produces legs that sum to zero, for every type and amount", () => {
    for (const type of TRANSACTION_TYPES) {
      for (const pesos of AMOUNTS) {
        if (isRefused(type, pesos)) continue;
        const { postings } = quote(type, pesos);
        const total = postings.reduce((sum, p) => sum + p.amount, 0);
        expect(total, `${type} at ${pesos}`).toBe(0);
      }
    }
  });

  it("never emits a zero leg, which gocash.postings rejects", () => {
    for (const type of TRANSACTION_TYPES) {
      for (const pesos of AMOUNTS) {
        if (isRefused(type, pesos)) continue;
        for (const p of quote(type, pesos).postings) {
          expect(p.amount, `${type} at ${pesos}`).not.toBe(0);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // Direction. This is the decision the operator made and the PRD contradicted:
  // Cash In means the customer hands over CASH and receives e-money, so the
  // drawer goes UP and the platform wallet goes DOWN. Written out per type
  // because a table saying which way each type moves money is the
  // delta-multiplier model that caused the original damage.
  // -------------------------------------------------------------------------
  it("Cash In takes cash in and sends e-money out", () => {
    const { postings, feeMinor } = quote("Cash In", 1000);
    expect(feeMinor).toBe(2000);                       // 2% of 1000 = PHP 20
    expect(leg(postings, "cash")).toBe(102000);        // 1000 + 20 collected
    expect(leg(postings, "GCash")).toBe(-100000);      // 1000 sent
    expect(leg(postings, "revenue")).toBe(-2000);      // fee earned
  });

  it("Cash Out pays cash out and takes e-money in", () => {
    const { postings, feeMinor } = quote("Cash Out", 1000);
    expect(feeMinor).toBe(2000);
    expect(leg(postings, "GCash")).toBe(100000);       // 1000 received
    expect(leg(postings, "cash")).toBe(-98000);        // 1000 - 20 handed over
    expect(leg(postings, "revenue")).toBe(-2000);
  });

  it("Profit Remittance moves the drawer to equity and touches no wallet", () => {
    const { postings, feeMinor } = quote("Profit Remittance", 5000);
    // Zero even though the fixture gives this type a 2% rule: there is no
    // revenue leg to put a fee on, so reporting one would promise the operator
    // earnings the ledger never records. Taking your own money out of the
    // drawer is not a sale.
    expect(feeMinor).toBe(0);
    expect(leg(postings, "cash")).toBe(-500000);
    expect(leg(postings, "equity")).toBe(500000);
    expect(leg(postings, "GCash")).toBe(0);
  });

  it("ignores the platform on a Profit Remittance", () => {
    // The form hides the wallet picker for this type, but a caller could still
    // send one. It must not end up on a leg, because nothing would ever read it.
    const withPlatform = quote("Profit Remittance", 5000, { platform: "Maya" });
    const without = quote("Profit Remittance", 5000, { platform: "" });
    expect(withPlatform.postings).toEqual(without.postings);
  });

  // -------------------------------------------------------------------------
  // Pricing edges
  // -------------------------------------------------------------------------
  it("applies the PHP 5 floor below PHP 250", () => {
    expect(quote("Cash In", 100).feeMinor).toBe(500);
    expect(quote("Cash In", 249).feeMinor).toBe(500);
    // 2% of 250 is exactly 5, so the floor and the rate agree here.
    expect(quote("Cash In", 250).feeMinor).toBe(500);
    expect(quote("Cash In", 251).feeMinor).toBe(600);  // 5.02 -> ceil to 6
  });

  it("charges Cash Out on the base when the amount already includes the fee", () => {
    // A customer wanting PHP 1,000 cash at 2% sends 1,020. Charging 2% of 1,020
    // bills the fee on the fee.
    const gross = quote("Cash Out", 1020, { amountIncludesFee: true });
    expect(gross.feeMinor).toBe(2000);                 // 1020 / 1.02 * 2%

    const naive = quote("Cash Out", 1020);
    expect(naive.feeMinor).toBe(2100);                 // 2% of 1020, rounded up
  });

  it("only un-grosses Cash Out", () => {
    // On the customer-pays-cash types the customer hands over amount + fee, so
    // the printed figure is the base by construction. Applying the adjustment
    // there would silently under-charge every one of them.
    for (const type of ["Cash In", "Telco Load", "Bills Payment", "Bank Transfer"] as const) {
      expect(
        quote(type, 1020, { amountIncludesFee: true }).feeMinor,
        type,
      ).toBe(quote(type, 1020).feeMinor);
    }
  });

  // -------------------------------------------------------------------------
  // Rule resolution. The reported rule and the charged fee must come from the
  // same lookup — a quote that says "no rule covers this" while displaying a
  // non-zero fee is worse than either answer alone.
  // -------------------------------------------------------------------------
  it("reports the rule it priced from", () => {
    const q = quote("Cash In", 1000);
    expect(q.rule).not.toBeNull();
    expect(q.rule?.rate_bps).toBe(200);
  });

  it("prefers an exact platform match over the 'all' fallback", () => {
    const rules: FeeRule[] = [
      ...RULES,
      { transaction_type: "Cash In", platform: "GCash", rate_bps: 100, minimum_minor: 0, is_active: true },
    ];
    const q = quote("Cash In", 1000, { rules });
    expect(q.rule?.platform).toBe("GCash");
    expect(q.feeMinor).toBe(1000);                     // 1% not 2%
  });

  it("reports no rule and charges nothing when none covers the combination", () => {
    const q = quote("Cash In", 1000, { rules: [] });
    expect(q.rule).toBeNull();
    expect(q.feeMinor).toBe(0);
    // Still balanced, still postable: an unpriced transaction earns nothing
    // rather than failing, which is what the live behaviour was.
    expect(q.postings.reduce((s, p) => s + p.amount, 0)).toBe(0);
    expect(leg(q.postings, "revenue")).toBe(0);
  });

  it("agrees with itself on the fee it reports and the fee it posts", () => {
    // The revenue leg IS the fee, negated. If these could differ the operator's
    // earnings would not match the figure the form promised them.
    for (const type of TRANSACTION_TYPES) {
      for (const pesos of AMOUNTS) {
        if (isRefused(type, pesos)) continue;
        const q = quote(type, pesos);
        // `-q.feeMinor || 0` normalises negative zero: a zero fee negates to -0,
        // leg() sums an empty list to +0, and toBe compares with Object.is,
        // which distinguishes them. The arithmetic is right; only the sign of
        // zero differs.
        expect(leg(q.postings, "revenue"), `${type} at ${pesos}`).toBe(-q.feeMinor || 0);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Refusals
  // -------------------------------------------------------------------------
  it("refuses a negative amount", () => {
    expect(() => quote("Cash In", -100)).toThrow();
  });

  it("refuses a Cash Out whose fee would exceed the payout", () => {
    // PHP 1 cash out against a PHP 5 floor: the operator would hand over
    // negative cash. The ledger would accept the arithmetic — it balances — so
    // this has to be refused before it becomes a posting.
    expect(() => quote("Cash Out", 1)).toThrow();
  });
});
