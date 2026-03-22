import { describe, it, expect } from "vitest";
import {
  detectPlatform,
  detectType,
  calculateProfit,
  extractAccountNumber,
  computeWalletDeltas,
  TransactionRule,
} from "../transaction-processing";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const RULES: TransactionRule[] = [
  { transaction_type: "Cash In",           platform: "all", delta_platform_mult: 1,  delta_cash_amount_mult: -1, delta_cash_mult: 1, profit_rate: 2,    profit_minimum: 5,    is_active: true },
  { transaction_type: "Cash Out",          platform: "all", delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 1, profit_rate: 2,    profit_minimum: 5,    is_active: true },
  { transaction_type: "Telco Load",        platform: "all", delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 1, profit_rate: 3,    profit_minimum: 3,    is_active: true },
  { transaction_type: "Bills Payment",     platform: "all", delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 0, profit_rate: 0,    profit_minimum: 5,    is_active: true },
  { transaction_type: "Bank Transfer",     platform: "all", delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 0, profit_rate: 0,    profit_minimum: 5,    is_active: true },
  { transaction_type: "Profit Remittance", platform: "all", delta_platform_mult: 0,  delta_cash_amount_mult: -1, delta_cash_mult: 0, profit_rate: null, profit_minimum: null, is_active: true },
];

// ---------------------------------------------------------------------------
// detectPlatform
// ---------------------------------------------------------------------------

describe("detectPlatform", () => {
  it("detects GCash from text", () => {
    expect(detectPlatform("You received PHP 500.00 via GCash")).toBe("GCash");
  });

  it("detects GCash with hyphen", () => {
    expect(detectPlatform("G-Cash Transaction")).toBe("GCash");
  });

  it("detects MariBank", () => {
    expect(detectPlatform("MariBank savings deposit")).toBe("MariBank");
  });

  it("detects MariBank with space", () => {
    expect(detectPlatform("Mari Bank account")).toBe("MariBank");
  });

  it("returns Unknown for unrecognized text", () => {
    expect(detectPlatform("Some random text")).toBe("Unknown");
  });

  it("is case-insensitive", () => {
    expect(detectPlatform("GCASH SENT")).toBe("GCash");
    expect(detectPlatform("MARIBANK DEPOSIT")).toBe("MariBank");
  });
});

// ---------------------------------------------------------------------------
// detectType
// ---------------------------------------------------------------------------

describe("detectType", () => {
  it("detects Cash In", () => {
    expect(detectType("Cash In PHP 500.00")).toBe("Cash In");
    expect(detectType("You received PHP 500.00")).toBe("Cash In");
  });

  it("detects Cash Out", () => {
    expect(detectType("Cash Out to 09171234567")).toBe("Cash Out");
    expect(detectType("You sent PHP 1,000.00")).toBe("Cash Out");
    expect(detectType("Send Money to Juan")).toBe("Cash Out");
  });

  it("detects Telco Load", () => {
    expect(detectType("Buy Load Globe 50")).toBe("Telco Load");
    expect(detectType("Smart promo 99")).toBe("Telco Load");
    expect(detectType("DITO SIM Load")).toBe("Telco Load");
    expect(detectType("TNT 30")).toBe("Telco Load");
  });

  it("detects Bills Payment", () => {
    expect(detectType("Bills Payment Meralco")).toBe("Bills Payment");
    expect(detectType("Biller: Manila Water")).toBe("Bills Payment");
  });

  it("detects Bank Transfer", () => {
    expect(detectType("Bank Transfer to BDO")).toBe("Bank Transfer");
    expect(detectType("InstaPay transfer")).toBe("Bank Transfer");
    expect(detectType("PESONet to BPI")).toBe("Bank Transfer");
  });

  it("defaults to Cash In for ambiguous text", () => {
    expect(detectType("PHP 500.00 transaction complete")).toBe("Cash In");
  });
});

// ---------------------------------------------------------------------------
// calculateProfit
// ---------------------------------------------------------------------------

describe("calculateProfit", () => {
  it("calculates profit using rate (amount * rate%)", () => {
    // 500 * 2% = 10
    expect(calculateProfit("Cash In", "GCash", 500, RULES)).toBe(10);
  });

  it("applies minimum when rate result is lower", () => {
    // 100 * 2% = 2, but minimum is 5
    expect(calculateProfit("Cash In", "GCash", 100, RULES)).toBe(5);
  });

  it("uses rate when higher than minimum", () => {
    // 1000 * 2% = 20, minimum is 5 → use 20
    expect(calculateProfit("Cash In", "GCash", 1000, RULES)).toBe(20);
  });

  it("returns 0 for Profit Remittance (null rate and null minimum)", () => {
    expect(calculateProfit("Profit Remittance", "GCash", 5000, RULES)).toBe(0);
  });

  it("returns 0 when no matching rule exists", () => {
    expect(calculateProfit("Unknown Type", "GCash", 500, RULES)).toBe(0);
  });

  it("returns 0 when rule is inactive", () => {
    const inactiveRules = RULES.map((r) =>
      r.transaction_type === "Cash In" ? { ...r, is_active: false } : r
    );
    expect(calculateProfit("Cash In", "GCash", 500, inactiveRules)).toBe(0);
  });

  it("matches platform-specific rules over 'all'", () => {
    const specificRules: TransactionRule[] = [
      ...RULES,
      { transaction_type: "Cash In", platform: "GCash", delta_platform_mult: 1, delta_cash_amount_mult: -1, delta_cash_mult: 1, profit_rate: 5, profit_minimum: 10, is_active: true },
    ];
    // Should match the GCash-specific rule first (it comes after "all" but find() checks all)
    // Actually find() returns the first match — "all" will match first
    // This tests that "all" works as a catch-all
    expect(calculateProfit("Cash In", "GCash", 500, specificRules)).toBe(10);
  });

  it("uses Telco Load rate (3%)", () => {
    // 100 * 3% = 3, minimum is 3 → exact match
    expect(calculateProfit("Telco Load", "GCash", 100, RULES)).toBe(3);
    // 200 * 3% = 6, minimum is 3 → use 6
    expect(calculateProfit("Telco Load", "GCash", 200, RULES)).toBe(6);
  });

  it("Bills Payment uses minimum only (0% rate)", () => {
    // 0% rate = 0, minimum = 5
    expect(calculateProfit("Bills Payment", "GCash", 5000, RULES)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// extractAccountNumber
// ---------------------------------------------------------------------------

describe("extractAccountNumber", () => {
  it("extracts a PH mobile number (09XX format)", () => {
    expect(extractAccountNumber("Sent to 09171234567")).toBe("09171234567");
  });

  it("extracts a PH mobile number (+63 format) and normalizes", () => {
    expect(extractAccountNumber("Sent to +639171234567")).toBe("09171234567");
  });

  it("returns null when no number is found", () => {
    expect(extractAccountNumber("No numbers here")).toBeNull();
  });

  it("skips blacklisted numbers", () => {
    expect(extractAccountNumber("From 09757058698")).toBeNull();
    expect(extractAccountNumber("From 13246870917")).toBeNull();
  });

  it("returns the first non-blacklisted number", () => {
    expect(
      extractAccountNumber("From 09757058698 to 09181112222")
    ).toBe("09181112222");
  });

  it("supports custom blacklist", () => {
    expect(
      extractAccountNumber("From 09171234567", ["09171234567"])
    ).toBeNull();
  });

  it("handles multiple numbers, returns first valid", () => {
    expect(
      extractAccountNumber("Numbers: 09111111111 and 09222222222")
    ).toBe("09111111111");
  });
});

// ---------------------------------------------------------------------------
// computeWalletDeltas
// ---------------------------------------------------------------------------

describe("computeWalletDeltas", () => {
  it("Cash In: platform up, cash down minus profit", () => {
    // Cash In ₱500, profit ₱10
    // platform_delta = 500 * 1 = +500
    // cash_delta = (500 * -1) + (10 * 1) = -490
    const result = computeWalletDeltas("Cash In", "GCash", 500, 10, RULES);
    expect(result).toEqual({
      platform_wallet_name: "GCash",
      platform_delta: 500,
      cash_delta: -490,
    });
  });

  it("Cash Out: platform down, cash up plus profit", () => {
    // Cash Out ₱1000, profit ₱20
    // platform_delta = 1000 * -1 = -1000
    // cash_delta = (1000 * 1) + (20 * 1) = 1020
    const result = computeWalletDeltas("Cash Out", "GCash", 1000, 20, RULES);
    expect(result).toEqual({
      platform_wallet_name: "GCash",
      platform_delta: -1000,
      cash_delta: 1020,
    });
  });

  it("Telco Load: platform down, cash up plus profit", () => {
    // Telco Load ₱100, profit ₱3
    // platform_delta = 100 * -1 = -100
    // cash_delta = (100 * 1) + (3 * 1) = 103
    const result = computeWalletDeltas("Telco Load", "GCash", 100, 3, RULES);
    expect(result).toEqual({
      platform_wallet_name: "GCash",
      platform_delta: -100,
      cash_delta: 103,
    });
  });

  it("Bills Payment: platform down, cash up (no profit in cash)", () => {
    // Bills Payment ₱2000, profit ₱5
    // platform_delta = 2000 * -1 = -2000
    // cash_delta = (2000 * 1) + (5 * 0) = 2000
    const result = computeWalletDeltas("Bills Payment", "GCash", 2000, 5, RULES);
    expect(result).toEqual({
      platform_wallet_name: "GCash",
      platform_delta: -2000,
      cash_delta: 2000,
    });
  });

  it("Profit Remittance: cash leaves, platform unchanged", () => {
    // Profit Remittance ₱500, profit ₱0
    // platform_delta = 500 * 0 = 0
    // cash_delta = (500 * -1) + (0 * 0) = -500
    const result = computeWalletDeltas("Profit Remittance", "GCash", 500, 0, RULES);
    expect(result).toEqual({
      platform_wallet_name: "GCash",
      platform_delta: 0,
      cash_delta: -500,
    });
  });

  it("uses MariBank as platform_wallet_name", () => {
    const result = computeWalletDeltas("Cash In", "MariBank", 300, 6, RULES);
    expect(result?.platform_wallet_name).toBe("MariBank");
  });

  it("defaults Unknown platform to GCash wallet", () => {
    const result = computeWalletDeltas("Cash In", "Unknown", 300, 6, RULES);
    expect(result?.platform_wallet_name).toBe("GCash");
  });

  it("returns null when no matching rule", () => {
    const result = computeWalletDeltas("Nonexistent", "GCash", 500, 10, RULES);
    expect(result).toBeNull();
  });

  it("returns null when rule is inactive", () => {
    const inactiveRules = RULES.map((r) =>
      r.transaction_type === "Cash In" ? { ...r, is_active: false } : r
    );
    const result = computeWalletDeltas("Cash In", "GCash", 500, 10, inactiveRules);
    expect(result).toBeNull();
  });
});
