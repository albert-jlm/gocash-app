/**
 * Shared domain types. No runtime imports — this file must load in Deno and in
 * the Next.js build unchanged.
 */

import type { Minor } from "./money.ts";

export type TransactionType =
  | "Cash In"
  | "Cash Out"
  | "Telco Load"
  | "Bills Payment"
  | "Bank Transfer"
  | "Profit Remittance";

export const TRANSACTION_TYPES: readonly TransactionType[] = [
  "Cash In",
  "Cash Out",
  "Telco Load",
  "Bills Payment",
  "Bank Transfer",
  "Profit Remittance",
] as const;

export function isTransactionType(v: string): v is TransactionType {
  return (TRANSACTION_TYPES as readonly string[]).includes(v);
}

/**
 * How a transaction moves money. Three shapes cover all six types.
 *
 * Deliberately NOT operator-configurable. Three NUMERIC(6,4) multiplier columns
 * were exactly that, and it is why four of six types were silently destroying
 * money in production. What operators configure is which platforms they use,
 * what they charge, and what they call things — never the direction.
 */
export type PostingShape =
  | "customer_pays_cash"   // Cash In, Telco Load, Bills Payment, Bank Transfer
  | "customer_pays_emoney" // Cash Out
  | "equity_draw";         // Profit Remittance

export const SHAPE_BY_TYPE: Readonly<Record<TransactionType, PostingShape>> = {
  "Cash In": "customer_pays_cash",
  "Telco Load": "customer_pays_cash",
  "Bills Payment": "customer_pays_cash",
  "Bank Transfer": "customer_pays_cash",
  "Cash Out": "customer_pays_emoney",
  "Profit Remittance": "equity_draw",
};

/** Account classes. `platform` is per-wallet; the other three are singletons. */
export type AccountKind = "platform" | "cash" | "revenue" | "equity";

export type AccountRef =
  | { kind: "platform"; platform: string }
  | { kind: "cash" }
  | { kind: "revenue" }
  | { kind: "equity" };

export interface Posting {
  account: AccountRef;
  /** Signed centavos. Positive means the account went up. */
  amount: Minor;
}

/**
 * Operator pricing. Direction lives in code; this is the part that is data.
 *
 * rate_bps is basis points so the rate is an exact integer: 200 = 2.00%.
 * The old schema used NUMERIC(6,4) percentages, which invited float drift.
 */
export interface FeeRule {
  transaction_type: string;
  /** A platform code, or "all" as the fallback. */
  platform: string;
  rate_bps: number;
  minimum_minor: Minor;
  is_active: boolean;
}
