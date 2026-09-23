/**
 * Posting tests. Written to be read as examples first, assertions second.
 * Amounts are centavos; the comments give the peso figures.
 */

import { describe, it, expect } from "vitest";
import {
  cashIn, cashOut, telcoLoad, billsPayment, bankTransfer, profitRemittance,
  buildPostings, openingBalances, reconcile, reverse, balanced, LedgerError,
} from "../postings.ts";
import { toMinor } from "../money.ts";
import { TRANSACTION_TYPES, type Posting } from "../types.ts";

/** Net effect on one account. Sums, so it works across concatenated entries. */
function leg(postings: Posting[], match: string): number {
  return postings
    .filter((p) => (p.account.kind === "platform" ? p.account.platform === match : p.account.kind === match))
    .reduce((s, p) => s + p.amount, 0);
}
const total = (p: Posting[]) => p.reduce((s, x) => s + x.amount, 0);
const php = toMinor;

// ---------------------------------------------------------------------------
// The invariant
// ---------------------------------------------------------------------------

describe("every entry balances to exactly zero", () => {
  const cases: [string, Posting[]][] = [
    ["cash in 500 @ 10", cashIn({ amountMinor: php(500), feeMinor: php(10), platform: "GCash" })],
    ["cash out 1000 @ 20", cashOut({ amountMinor: php(1000), feeMinor: php(20), platform: "GCash" })],
    ["telco load 100 @ 3", telcoLoad({ amountMinor: php(100), feeMinor: php(3), platform: "GCash" })],
    ["bills payment 1850 @ 15", billsPayment({ amountMinor: php(1850), feeMinor: php(15), platform: "GCash" })],
    ["bank transfer 2000 @ 25", bankTransfer({ amountMinor: php(2000), feeMinor: php(25), platform: "MariBank" })],
    ["profit remittance 5000", profitRemittance({ amountMinor: php(5000) })],
  ];
  for (const [name, postings] of cases) {
    it(name, () => expect(total(postings)).toBe(0));
  }

  it("PROPERTY: holds for every type across a wide sweep of amounts and fees", () => {
    const amounts = [1, 50, 100, 333, 999, 1850, 12345, 999999];
    const fees = [0, 1, 5, 7, 666, 2000];
    let checked = 0;
    for (const txType of TRANSACTION_TYPES) {
      for (const a of amounts) {
        for (const f of fees) {
          const postings = buildPostings(txType, {
            amountMinor: php(a), feeMinor: php(f), platform: "GCash",
          });
          expect(total(postings), `${txType} amount=${a} fee=${f}`).toBe(0);
          checked++;
        }
      }
    }
    expect(checked).toBe(TRANSACTION_TYPES.length * amounts.length * fees.length);
  });

  it("no float drift: 2% of 333 is 6.66 and the entry still sums to 0", () => {
    const postings = cashIn({ amountMinor: php(333), feeMinor: php(6.66), platform: "GCash" });
    expect(total(postings)).toBe(0);
    expect(leg(postings, "cash")).toBe(php(339.66));
  });
});

// ---------------------------------------------------------------------------
// Direction — the bug that shipped
// ---------------------------------------------------------------------------

describe("cash in: customer hands over cash, receives e-money", () => {
  const p = cashIn({ amountMinor: php(500), feeMinor: php(10), platform: "GCash" });
  it("cash goes UP by amount + fee", () => expect(leg(p, "cash")).toBe(php(510)));
  it("the platform wallet goes DOWN by the amount", () => expect(leg(p, "GCash")).toBe(php(-500)));
  it("revenue records the fee", () => expect(leg(p, "revenue")).toBe(php(-10)));

  it("REGRESSION: platform negative, cash positive", () => {
    // onboarding/page.tsx seeds the exact inverse. Operator confirmed this
    // direction; the seed and the Settings copy are what is wrong.
    expect(leg(p, "GCash")).toBeLessThan(0);
    expect(leg(p, "cash")).toBeGreaterThan(0);
  });
});

describe("cash out: customer sends e-money, receives cash", () => {
  const p = cashOut({ amountMinor: php(1000), feeMinor: php(20), platform: "GCash" });
  it("the platform wallet goes UP by the full amount", () => expect(leg(p, "GCash")).toBe(php(1000)));
  it("cash goes DOWN by amount minus fee — deducted, not added", () => expect(leg(p, "cash")).toBe(php(-980)));
  it("is the mirror of cash in on the platform leg", () => {
    const inn = cashIn({ amountMinor: php(1000), feeMinor: php(20), platform: "GCash" });
    expect(leg(p, "GCash")).toBe(-leg(inn, "GCash"));
    expect(leg(p, "revenue")).toBe(leg(inn, "revenue")); // both earn
  });
});

// ---------------------------------------------------------------------------
// The four types that are wrong in production right now
// ---------------------------------------------------------------------------

describe("types that currently lose money live", () => {
  it("telco load books the customer's cash (live books only the fee)", () => {
    const p = telcoLoad({ amountMinor: php(100), feeMinor: php(3), platform: "GCash" });
    expect(leg(p, "GCash")).toBe(php(-100));
    expect(leg(p, "cash")).toBe(php(103));   // live gives +3, losing 100
    expect(total(p)).toBe(0);
  });

  it("bills payment does not evaporate 1,835", () => {
    const p = billsPayment({ amountMinor: php(1850), feeMinor: php(15), platform: "GCash" });
    expect(leg(p, "cash")).toBe(php(1865));  // live gives +15
    expect(total(p)).toBe(0);
  });

  it("bank transfer books both principal and fee (live books neither)", () => {
    const p = bankTransfer({ amountMinor: php(2000), feeMinor: php(25), platform: "MariBank" });
    expect(leg(p, "MariBank")).toBe(php(-2000));
    expect(leg(p, "cash")).toBe(php(2025));  // live gives +0
    expect(leg(p, "revenue")).toBe(php(-25));
  });

  it("profit remittance removes cash and names the destination", () => {
    const p = profitRemittance({ amountMinor: php(5000) });
    expect(leg(p, "cash")).toBe(php(-5000)); // live "all" rule gives +5000
    expect(leg(p, "equity")).toBe(php(5000));
    expect(leg(p, "GCash")).toBe(0);         // must not touch a wallet
  });
});

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

describe("corrections happen by reversal, not mutation", () => {
  it("a reversal returns every balance to where it started", () => {
    const original = cashIn({ amountMinor: php(500), feeMinor: php(10), platform: "GCash" });
    const undo = reverse(original);
    expect(total([...original, ...undo])).toBe(0);
    expect(leg([...original, ...undo], "cash")).toBe(0);
  });

  it("worked example: a 500 cash in was really 600", () => {
    const wrong = cashIn({ amountMinor: php(500), feeMinor: php(10), platform: "GCash" });
    const undo = reverse(wrong);
    const right = cashIn({ amountMinor: php(600), feeMinor: php(12), platform: "GCash" });
    const all = [...wrong, ...undo, ...right];
    expect(leg(all, "cash")).toBe(php(612));
    expect(leg(all, "GCash")).toBe(php(-600));
    expect(leg(all, "revenue")).toBe(php(-12));
    expect(total(all)).toBe(0);
  });

  it("switching platform moves the whole amount between wallets", () => {
    const wrong = cashIn({ amountMinor: php(500), feeMinor: php(10), platform: "GCash" });
    const right = cashIn({ amountMinor: php(500), feeMinor: php(10), platform: "Maya" });
    const all = [...wrong, ...reverse(wrong), ...right];
    expect(leg(all, "GCash")).toBe(0);
    expect(leg(all, "Maya")).toBe(php(-500));
  });
});

// ---------------------------------------------------------------------------
// Opening balances and the drawer count
// ---------------------------------------------------------------------------

describe("opening balances and reconciliation", () => {
  it("onboards 8,000 GCash / 3,000 MariBank / 12,000 cash", () => {
    const p = openingBalances([
      { account: { kind: "platform", platform: "GCash" }, amount: php(8000) },
      { account: { kind: "platform", platform: "MariBank" }, amount: php(3000) },
      { account: { kind: "cash" }, amount: php(12000) },
    ]);
    expect(leg(p, "equity")).toBe(php(-23000)); // the owner put 23,000 in
    expect(total(p)).toBe(0);
  });

  it("books a PHP 50 shortfall in the drawer", () => {
    const p = reconcile({
      account: { kind: "cash" },
      bookBalanceMinor: php(12450),
      countedBalanceMinor: php(12400),
    });
    expect(leg(p, "cash")).toBe(php(-50));
    expect(leg(p, "equity")).toBe(php(50));
  });

  it("a perfect count writes nothing at all", () => {
    expect(() => reconcile({
      account: { kind: "cash" }, bookBalanceMinor: php(5000), countedBalanceMinor: php(5000),
    })).toThrow(LedgerError);
  });
});

// ---------------------------------------------------------------------------
// The guard rail
// ---------------------------------------------------------------------------

describe("balanced() refuses to build a broken entry", () => {
  it("rejects the live Bills Payment rule, expressed as postings", () => {
    expect(() => balanced([
      { account: { kind: "platform", platform: "GCash" }, amount: php(-1850) },
      { account: { kind: "cash" }, amount: php(15) },
    ])).toThrow(/does not balance: sum = -183500 centavos/);
  });

  it("names the offending legs", () => {
    expect(() => balanced([
      { account: { kind: "cash" }, amount: 10000 },
      { account: { kind: "revenue" }, amount: -500 },
    ])).toThrow(/cash \+10000, revenue -500/);
  });

  it("rejects a one-sided entry", () => {
    expect(() => balanced([{ account: { kind: "cash" }, amount: 100 }]))
      .toThrow(/at least 2 postings/);
  });

  it("rejects non-integer centavos before they reach the database", () => {
    expect(() => balanced([
      { account: { kind: "cash" }, amount: 10.5 },
      { account: { kind: "revenue" }, amount: -10.5 },
    ])).toThrow(/integer centavos/);
  });

  it("omits the revenue leg when there is no fee", () => {
    const p = cashIn({ amountMinor: php(500), feeMinor: 0, platform: "GCash" });
    expect(p).toHaveLength(2);
    expect(leg(p, "revenue")).toBe(0);
  });

  it("rejects an unknown transaction type", () => {
    expect(() => buildPostings("Padala", { amountMinor: php(100), feeMinor: 0, platform: "GCash" }))
      .toThrow(/unknown transaction type/);
  });
});
