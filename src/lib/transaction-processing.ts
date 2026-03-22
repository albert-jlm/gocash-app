/**
 * Core business logic for GoCash transaction processing.
 * Pure TypeScript — no runtime-specific imports.
 * Shared between Supabase Edge Functions and unit tests.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransactionType =
  | "Cash In"
  | "Cash Out"
  | "Telco Load"
  | "Bills Payment"
  | "Bank Transfer"
  | "Profit Remittance";

export type Platform = "GCash" | "MariBank" | "Unknown";

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
  /** Name of the platform wallet to update, e.g. "GCash" or "MariBank" */
  platform_wallet_name: string;
  /** Amount to add (or subtract if negative) from the platform wallet */
  platform_delta: number;
  /** Amount to add (or subtract if negative) from the Cash wallet */
  cash_delta: number;
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

/** Detect which mobile money platform a screenshot belongs to. */
export function detectPlatform(text: string): Platform {
  const t = text.toLowerCase();
  if (t.includes("gcash") || t.includes("g-cash")) return "GCash";
  if (t.includes("maribank") || t.includes("mari bank")) return "MariBank";
  return "Unknown";
}

// ---------------------------------------------------------------------------
// Transaction type detection
// ---------------------------------------------------------------------------

/** Infer transaction type from OCR text when the AI model is uncertain. */
export function detectType(text: string): TransactionType {
  const t = text.toLowerCase();

  if (
    t.includes("cash in") ||
    t.includes("cashin") ||
    t.includes("you received")
  )
    return "Cash In";

  if (
    t.includes("cash out") ||
    t.includes("cashout") ||
    t.includes("send money") ||
    t.includes("you sent") ||
    t.includes("sent to")
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

  return "Cash In"; // safe default for ambiguous screenshots
}

// ---------------------------------------------------------------------------
// Profit calculation
// ---------------------------------------------------------------------------

/**
 * Calculate operator profit using the matching transaction rule.
 * Rules are checked for platform match ("all" matches any platform).
 *
 * Formula: profit = max(amount × profit_rate%, profit_minimum)
 */
export function calculateProfit(
  txType: string,
  platform: string,
  amount: number,
  rules: TransactionRule[]
): number {
  const rule = rules.find(
    (r) =>
      r.is_active &&
      r.transaction_type === txType &&
      (r.platform === "all" || r.platform === platform)
  );

  if (!rule || (rule.profit_rate === null && rule.profit_minimum === null))
    return 0;

  let profit = rule.profit_rate ? (amount * rule.profit_rate) / 100 : 0;
  if (rule.profit_minimum) profit = Math.max(profit, rule.profit_minimum);

  return Math.round(profit * 100) / 100;
}

// ---------------------------------------------------------------------------
// Account number extraction
// ---------------------------------------------------------------------------

/** Numbers that belong to the operator — never recorded as customer accounts. */
const DEFAULT_BLACKLIST = ["09757058698", "13246870917"];

/**
 * Extract the customer's mobile number from OCR text.
 * Returns null if no valid non-blacklisted number is found.
 */
export function extractAccountNumber(
  text: string,
  blacklist: string[] = DEFAULT_BLACKLIST
): string | null {
  // Match PH mobile numbers: 09XXXXXXXXX or +639XXXXXXXXX
  const matches = text.match(/(?:\+639|09)\d{9}/g);
  if (!matches) return null;

  for (const raw of matches) {
    const normalized = raw.startsWith("+63") ? "0" + raw.slice(3) : raw;
    if (!blacklist.includes(normalized)) return normalized;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Wallet delta computation
// ---------------------------------------------------------------------------

/**
 * Compute how wallet balances should change when a transaction is confirmed.
 *
 * Delta encoding (from transaction_rules):
 *   platform_delta = amount × delta_platform_mult
 *   cash_delta     = (amount × delta_cash_amount_mult) + (profit × delta_cash_mult)
 *
 * "Cash In" = cash enters operator's register (customer cashes out GCash for PHP).
 * "Cash Out" = cash leaves operator's register (customer loads GCash with PHP).
 */
export function computeWalletDeltas(
  txType: string,
  platform: string,
  amount: number,
  netProfit: number,
  rules: TransactionRule[]
): WalletDelta | null {
  const rule = rules.find(
    (r) =>
      r.is_active &&
      r.transaction_type === txType &&
      (r.platform === "all" || r.platform === platform)
  );

  if (!rule) return null;

  return {
    platform_wallet_name: platform === "Unknown" ? "GCash" : platform,
    platform_delta: amount * rule.delta_platform_mult,
    cash_delta:
      amount * rule.delta_cash_amount_mult + netProfit * rule.delta_cash_mult,
  };
}
