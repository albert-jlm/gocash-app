import { describe, it, expect } from "vitest";
import { toMinor, toPesos, ceilToUnit, formatMinor, MoneyError, parsePesosInput } from "../money.ts";

describe("peso <-> centavo conversion", () => {
  it("converts whole and fractional pesos exactly", () => {
    expect(toMinor(500)).toBe(50000);
    expect(toMinor(6.66)).toBe(666);
    expect(toMinor(0.01)).toBe(1);
    expect(toMinor(0)).toBe(0);
  });

  it("rounds half away from zero, in both directions", () => {
    expect(toMinor(0.005)).toBe(1);
    expect(toMinor(-0.005)).toBe(-1); // Math.round alone would give -0
  });

  it("survives the float case that breaks naive summing", () => {
    // 339.66 - 333 - 6.66 !== 0 in float64; in centavos it is exact.
    expect(toMinor(339.66) - toMinor(333) - toMinor(6.66)).toBe(0);
  });

  it("round-trips", () => {
    for (const p of [0, 1, 6.66, 1850, 99999.99]) {
      expect(toPesos(toMinor(p))).toBeCloseTo(p, 2);
    }
  });

  it("rejects non-finite input", () => {
    expect(() => toMinor(NaN)).toThrow(MoneyError);
    expect(() => toMinor(Infinity)).toThrow(MoneyError);
  });
});

describe("ceilToUnit — whole-peso fee rounding", () => {
  it("rounds up to the next peso", () => {
    expect(ceilToUnit(666)).toBe(700);
    expect(ceilToUnit(601)).toBe(700);
  });
  it("leaves a whole peso alone", () => {
    expect(ceilToUnit(700)).toBe(700);
    expect(ceilToUnit(0)).toBe(0);
  });
});

describe("formatMinor", () => {
  it("groups thousands and always shows two decimals", () => {
    expect(formatMinor(186500)).toBe("PHP 1,865.00");
    expect(formatMinor(666)).toBe("PHP 6.66");
    expect(formatMinor(5)).toBe("PHP 0.05");
  });
  it("handles negatives", () => {
    expect(formatMinor(-50000)).toBe("-PHP 500.00");
  });
});

describe("parsePesosInput — what a person typed, read exactly or not at all", () => {
  it("reads plain and comma-grouped amounts to centavos", () => {
    expect(parsePesosInput("1850")).toBe(185000);
    expect(parsePesosInput("1,850")).toBe(185000);
    expect(parsePesosInput("12,500.50")).toBe(1250050);
    expect(parsePesosInput("1,234,567.8")).toBe(123456780);
    expect(parsePesosInput("₱ 1,850")).toBe(185000);
    expect(parsePesosInput(" 500 ")).toBe(50000);
    expect(parsePesosInput("6.66")).toBe(666);
    expect(parsePesosInput(".5")).toBe(50);
    expect(parsePesosInput("0")).toBe(0);
  });

  it("is exact where float parsing is not", () => {
    // 1.15 * 100 is 114.99999999999999 in float64.
    expect(parsePesosInput("1.15")).toBe(115);
    expect(parsePesosInput("339.66")).toBe(33966);
  });

  it("refuses anything parseFloat would silently truncate", () => {
    // parseFloat gives 1, 12 and 500 for the first three.
    expect(parsePesosInput("1,85")).toBeNull();
    expect(parsePesosInput("12,5000")).toBeNull();
    expect(parsePesosInput("500abc")).toBeNull();
    expect(parsePesosInput("1.850,00")).toBeNull();
    expect(parsePesosInput("1850.505")).toBeNull();
    expect(parsePesosInput("5e3")).toBeNull();
    expect(parsePesosInput("-5")).toBeNull();
    expect(parsePesosInput("")).toBeNull();
    expect(parsePesosInput("   ")).toBeNull();
    expect(parsePesosInput(".")).toBeNull();
    expect(parsePesosInput("₱")).toBeNull();
  });
});
