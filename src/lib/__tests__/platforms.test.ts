import { describe, expect, it } from "vitest";
import {
  comparePlatformNames,
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
});

