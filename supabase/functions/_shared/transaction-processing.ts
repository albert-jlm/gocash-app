
export type TransactionType =
  | "Cash In"
  | "Cash Out"
  | "Telco Load"
  | "Bills Payment"
  | "Bank Transfer"
  | "Profit Remittance";

export type Platform = "GCash" | "MariBank" | "Maya" | "Unknown";

export interface TransactionRule {
  transaction_type: string;
  platform: string;
  delta_platform_mult: number;
  delta_cash_amount_mult: number;
  delta_cash_mult: number;
  profit_rate: number | null;
  profit_minimum: number | null;
  is_active: boolean;
}

export interface WalletDelta {
  platform_wallet_name: string;
  platform_delta: number;
  cash_delta: number;
}

export function detectPlatform(text: string): Platform {
  const t = text.toLowerCase();
  if (t.includes("gcash") || t.includes("g-cash")) return "GCash";
  if (t.includes("maribank") || t.includes("mari bank")) return "MariBank";
  if (t.includes("maya") || t.includes("paymaya")) return "Maya";
  return "Unknown";
}

export function detectType(text: string): TransactionType {
  const t = text.toLowerCase();

  if (
    t.includes("cash in") ||
    t.includes("cashin") ||
    t.includes("send money") ||
    t.includes("you sent") ||
    t.includes("sent to")
  )
    return "Cash In";

  if (
    t.includes("cash out") ||
    t.includes("cashout") ||
    t.includes("you received")
  )
    return "Cash Out";

  if (
    t.includes(" load") ||
    t.includes("promo") ||
    t.includes("globe") ||
    t.includes("smart") ||
    t.includes("dito") ||
    t.includes("tnt") ||
    t.includes("tm ") ||
    t.includes("touch mobile")
  )
    return "Telco Load";

  if (t.includes("bills") || t.includes("bill payment") || t.includes("biller"))
    return "Bills Payment";

  if (
    t.includes("bank transfer") ||
    t.includes("instapay") ||
    t.includes("pesonet") ||
    t.includes("transfer to bank")
  )
    return "Bank Transfer";

  return "Cash In";
}

function resolveRule(
  txType: string,
  platform: string,
  rules: TransactionRule[]
): TransactionRule | undefined {
  const exact = rules.find(
    (r) => r.is_active && r.transaction_type === txType && r.platform === platform
  );
  if (exact) return exact;
  return rules.find(
    (r) => r.is_active && r.transaction_type === txType && r.platform === "all"
  );
}

export function calculateProfit(
  txType: string,
  platform: string,
  amount: number,
  rules: TransactionRule[]
): number {
  const rule = resolveRule(txType, platform, rules);

  if (!rule || (rule.profit_rate === null && rule.profit_minimum === null))
    return 0;

  const ratePercent = rule.profit_rate ?? 0;
  const minimum = rule.profit_minimum ?? 0;
  const rate = ratePercent / 100;

  let profit = rate > 0 ? amount * rate : 0;

  // Cash Out screenshots may show the full amount already including the fee.
  // When the amount cleanly divides back to a likely whole-peso base, compute
  // the fee from that base instead of charging the fee twice.
  if (txType === "Cash Out" && rate > 0) {
    const rawBase = amount / (1 + rate);
    const isGrossAmountWithIncludedFee =
      rawBase > 250 && Math.abs(rawBase - Math.round(rawBase)) < 0.000001;

    if (isGrossAmountWithIncludedFee) {
      profit = rawBase * rate;
    }
  }

  if (txType === "Cash In" || txType === "Cash Out") {
    return Math.ceil(Math.max(profit, minimum));
  }

  if (minimum) profit = Math.max(profit, minimum);

  return Math.round(profit * 100) / 100;
}

const DEFAULT_BLACKLIST = ["09757058698", "13246870917"];

export function extractAccountNumber(
  text: string,
  blacklist: string[] = DEFAULT_BLACKLIST
): string | null {
  const matches = text.match(/(?:\+639|09)\d{9}/g);
  if (!matches) return null;

  for (const raw of matches) {
    const normalized = raw.startsWith("+63") ? "0" + raw.slice(3) : raw;
    if (!blacklist.includes(normalized)) return normalized;
  }

  return null;
}

export function computeWalletDeltas(
  txType: string,
  platform: string,
  amount: number,
  netProfit: number,
  rules: TransactionRule[]
): WalletDelta | null {
  const rule = resolveRule(txType, platform, rules);

  if (!rule) return null;

  return {
    platform_wallet_name: platform === "Unknown" ? "GCash" : platform,
    platform_delta: amount * rule.delta_platform_mult,
    cash_delta:
      amount * rule.delta_cash_amount_mult + netProfit * rule.delta_cash_mult,
  };
}
