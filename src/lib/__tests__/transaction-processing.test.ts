import { describe, it, expect } from "vitest";
import {
  detectPlatform,
  detectType,
  calculateProfit,
  extractAccountNumber,
  computeWalletDeltas,
  type TransactionRule,
} from "../../../supabase/functions/_shared/transaction-processing";

const RULES: TransactionRule[] = [
  { transaction_type: "Cash In",           platform: "all", delta_platform_mult: 1,  delta_cash_amount_mult: -1, delta_cash_mult: 1, profit_rate: 2,    profit_minimum: 5,    is_active: true },
  { transaction_type: "Cash Out",          platform: "all", delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 1, profit_rate: 2,    profit_minimum: 5,    is_active: true },
  { transaction_type: "Telco Load",        platform: "all", delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 1, profit_rate: 3,    profit_minimum: 3,    is_active: true },
  { transaction_type: "Bills Payment",     platform: "all", delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 0, profit_rate: 0,    profit_minimum: 5,    is_active: true },
  { transaction_type: "Bank Transfer",     platform: "all", delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 0, profit_rate: 0,    profit_minimum: 5,    is_active: true },
  { transaction_type: "Profit Remittance", platform: "all", delta_platform_mult: 0,  delta_cash_amount_mult: -1, delta_cash_mult: 0, profit_rate: null, profit_minimum: null, is_active: true },
];

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

  it("detects Maya", () => {
    expect(detectPlatform("PayMaya payment complete")).toBe("Maya");
  });

  it("is case-insensitive", () => {
    expect(detectPlatform("GCASH SENT")).toBe("GCash");
    expect(detectPlatform("MARIBANK DEPOSIT")).toBe("MariBank");
    expect(detectPlatform("MAYA transfer")).toBe("Maya");
  });
});

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

describe("calculateProfit", () => {
  it("calculates profit using rate (amount * rate%)", () => {
    expect(calculateProfit("Cash In", "GCash", 500, RULES)).toBe(10);
  });

  it("applies minimum when rate result is lower", () => {
    expect(calculateProfit("Cash In", "GCash", 100, RULES)).toBe(5);
  });

  it("uses rate when higher than minimum", () => {
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
    expect(calculateProfit("Cash In", "GCash", 500, specificRules)).toBe(25);
  });

  it("uses Telco Load rate (3%)", () => {
    expect(calculateProfit("Telco Load", "GCash", 100, RULES)).toBe(3);
    expect(calculateProfit("Telco Load", "GCash", 200, RULES)).toBe(6);
  });

  it("Bills Payment uses minimum only (0% rate)", () => {
    expect(calculateProfit("Bills Payment", "GCash", 5000, RULES)).toBe(5);
  });
});

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

describe("computeWalletDeltas", () => {
  it("Cash In: platform up, cash down minus profit", () => {
    const result = computeWalletDeltas("Cash In", "GCash", 500, 10, RULES);
    expect(result).toEqual({
      platform_wallet_name: "GCash",
      platform_delta: 500,
      cash_delta: -490,
    });
  });

  it("Cash Out: platform down, cash up plus profit", () => {
    const result = computeWalletDeltas("Cash Out", "GCash", 1000, 20, RULES);
    expect(result).toEqual({
      platform_wallet_name: "GCash",
      platform_delta: -1000,
      cash_delta: 1020,
    });
  });

  it("Telco Load: platform down, cash up plus profit", () => {
    const result = computeWalletDeltas("Telco Load", "GCash", 100, 3, RULES);
    expect(result).toEqual({
      platform_wallet_name: "GCash",
      platform_delta: -100,
      cash_delta: 103,
    });
  });

  it("Bills Payment: platform down, cash up (no profit in cash)", () => {
    const result = computeWalletDeltas("Bills Payment", "GCash", 2000, 5, RULES);
    expect(result).toEqual({
      platform_wallet_name: "GCash",
      platform_delta: -2000,
      cash_delta: 2000,
    });
  });

  it("Profit Remittance: cash leaves, platform unchanged", () => {
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

  it("uses Maya as platform_wallet_name", () => {
    const result = computeWalletDeltas("Cash In", "Maya", 300, 6, RULES);
    expect(result?.platform_wallet_name).toBe("Maya");
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
