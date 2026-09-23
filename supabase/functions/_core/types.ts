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
 * NOTE: an earlier draft exported a `SHAPE_BY_TYPE` map here, grouping the six
 * types into three posting shapes. It was removed unused, and deliberately:
 * a lookup table saying which direction each type moves money is *exactly*
 * the delta-multiplier model in nicer syntax, and re-encoding direction as
 * data is the bug class this rebuild exists to eliminate. The shapes are
 * visible in postings.ts, where each type is written out in full and each has
 * a test asserting the sign of every leg.
 */

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
