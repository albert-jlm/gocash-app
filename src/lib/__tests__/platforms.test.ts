import { describe, expect, it } from "vitest";
import {
  buildFinancialSettingsHref,
  coerceFinancialSettingsTab,
  comparePlatformNames,
  DEFAULT_PLATFORM_RULE_TEMPLATES,
  getDefaultWalletColor,
  getWalletColor,
  isBuiltInPlatform,
  sortPlatformNames,
  sortWallets,
} from "../platforms";

describe("platform helpers", () => {
  it("recognizes built-in platform names", () => {
    expect(isBuiltInPlatform("GCash")).toBe(true);
    expect(isBuiltInPlatform("Maya")).toBe(true);
    expect(isBuiltInPlatform("ShopeePay")).toBe(false);
  });

  it("returns default wallet colors", () => {
    expect(getDefaultWalletColor("GCash")).toBe("blue");
    expect(getDefaultWalletColor("MariBank")).toBe("orange");
    expect(getDefaultWalletColor("Maya")).toBe("emerald");
    expect(getDefaultWalletColor("Cash")).toBe("rose");
    expect(getDefaultWalletColor("ShopeePay")).toBe("zinc");
  });

  it("returns palette metadata for a wallet color", () => {
    expect(getWalletColor("cyan").label).toBe("Cyan");
    expect(getWalletColor("unknown").label).toBe("Gray");
  });

  it("sorts built-ins before custom platforms", () => {
    expect(sortPlatformNames(["ShopeePay", "Maya", "GCash", "MariBank"])).toEqual([
      "GCash",
      "MariBank",
      "Maya",
      "ShopeePay",
    ]);
  });

  it("compares platform names consistently", () => {
    expect(comparePlatformNames("GCash", "ShopeePay")).toBeLessThan(0);
    expect(comparePlatformNames("ShopeePay", "GCash")).toBeGreaterThan(0);
  });

  it("sorts platform wallets before cash wallets", () => {
    expect(
      sortWallets([
        { wallet_name: "Cash", wallet_type: "cash" },
        { wallet_name: "ShopeePay", wallet_type: "platform" },
        { wallet_name: "GCash", wallet_type: "platform" },
      ])
    ).toEqual([
      { wallet_name: "GCash", wallet_type: "platform" },
      { wallet_name: "ShopeePay", wallet_type: "platform" },
      { wallet_name: "Cash", wallet_type: "cash" },
    ]);
  });

  it("coerces unknown settings tabs to wallets", () => {
    expect(coerceFinancialSettingsTab("platforms")).toBe("platforms");
    expect(coerceFinancialSettingsTab("unknown")).toBe("wallets");
    expect(coerceFinancialSettingsTab(null)).toBe("wallets");
  });

  it("builds settings links with optional restore platform", () => {
    expect(buildFinancialSettingsHref("profit")).toBe("/settings?tab=profit");
    expect(buildFinancialSettingsHref("platforms", "GCash")).toBe(
      "/settings?tab=platforms&restorePlatform=GCash"
    );
  });

  it("includes a default rule template for each transaction type", () => {
    expect(DEFAULT_PLATFORM_RULE_TEMPLATES).toHaveLength(6);
    expect(DEFAULT_PLATFORM_RULE_TEMPLATES.some((rule) => rule.transaction_type === "Cash In")).toBe(true);
    expect(
      DEFAULT_PLATFORM_RULE_TEMPLATES.some((rule) => rule.transaction_type === "Profit Remittance")
    ).toBe(true);
  });
});
