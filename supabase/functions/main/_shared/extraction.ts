/**
 * From "the model answered" to "these are the fields of the draft".
 *
 * This is the step where a misread screenshot becomes a transaction. It used
 * to be eight lines inside the HTTP handler, with three defaults that each
 * turned "I could not read this" into a confident wrong answer:
 *
 *   - an unknown type became "Cash In" (which inverts a Cash Out),
 *   - an unknown platform became whichever brand the text mentioned first,
 *   - an unreadable amount became 0 (and the minimum fee was then posted
 *     against nothing).
 *
 * All three balanced, so no ledger check could catch them. Here an unknown
 * stays unknown and is listed in `needsReview`; the confirm screen leaves that
 * field empty and will not save until the operator fills it in.
 *
 * It lives in its own module so the handler and the replay harness
 * (tests/ocr) run the same function instead of the harness mirroring it.
 */

import {
  detectPlatform,
  detectType,
  extractAccountNumber,
  isOperatorNumber,
} from "./transaction-processing.ts";
import { TRANSACTION_TYPES } from "../../_core/types.ts";
import { MAX_AMOUNT_MINOR, parsePesosInput } from "../../_core/money.ts";

/** What JSON.parse handed back. Nothing here is trusted to have its type. */
export interface ModelAnswer {
  raw_text?: unknown;
  platform?: unknown;
  transaction_type?: unknown;
  amount?: unknown;
  reference_number?: unknown;
  account_number?: unknown;
  transaction_date?: unknown;
}

export type ReviewField = "platform" | "transaction_type" | "amount";

export interface ExtractedFields {
  rawText: string;
  /** A known platform name, or "Unknown". */
  platform: string;
  /** One of TRANSACTION_TYPES, or "Unknown". */
  txType: string;
  /** Pesos, greater than zero. null when the amount could not be read. */
  amount: number | null;
  referenceNumber: string | null;
  accountNumber: string | null;
  transactionDate: string | null;
  /** Fields the operator must supply before this draft can be confirmed. */
  needsReview: ReviewField[];
}

// The model is offered these three. Older branding is folded in; anything
// else it invents is treated as Unknown.
const PLATFORM_ALIASES: Record<string, string> = {
  gcash: "GCash",
  "g-cash": "GCash",
  maribank: "MariBank",
  seabank: "MariBank",
  maya: "Maya",
  paymaya: "Maya",
};

function text(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  // A reference returned as a JSON number is still a reference.
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Pesos > 0 and within the accepted maximum, read exactly; otherwise null. */
function readAmount(v: unknown): number | null {
  let minor: number | null = null;
  if (typeof v === "number" && Number.isFinite(v)) {
    minor = Math.round(v * 100);
    // More than two decimals is not a peso amount; do not round it into one.
    if (Math.abs(v * 100 - minor) > 1e-6) minor = null;
  } else if (typeof v === "string") {
    // JSON mode guarantees valid JSON, not a schema: "1,250.00" does arrive.
    minor = parsePesosInput(v.replace(/^PHP/i, ""));
  }
  if (minor === null || minor <= 0 || minor > MAX_AMOUNT_MINOR) return null;
  return minor / 100;
}

export function extractFields(ai: ModelAnswer): ExtractedFields {
  const rawText = typeof ai.raw_text === "string" ? ai.raw_text : "";
  const needsReview: ReviewField[] = [];

  // ----- platform -----
  const claimedPlatform = text(ai.platform);
  const platform =
    (claimedPlatform && PLATFORM_ALIASES[claimedPlatform.toLowerCase().replace(/\s+/g, "")])
    ?? detectPlatform(rawText);
  if (platform === "Unknown") needsReview.push("platform");

  // ----- type -----
  const claimedType = text(ai.transaction_type);
  const txType =
    claimedType && (TRANSACTION_TYPES as readonly string[]).includes(claimedType)
      ? claimedType
      : detectType(rawText);
  if (txType === "Unknown") needsReview.push("transaction_type");

  // ----- amount -----
  const amount = readAmount(ai.amount);
  if (amount === null) needsReview.push("amount");

  // ----- customer number -----
  // The blacklist used to run only inside the fallback, so the operator's own
  // number was accepted whenever the model returned it directly.
  const claimedNumber = text(ai.account_number);
  const accountNumber =
    claimedNumber && !isOperatorNumber(claimedNumber)
      ? claimedNumber
      : extractAccountNumber(rawText);

  return {
    rawText,
    platform,
    txType,
    amount,
    referenceNumber: text(ai.reference_number),
    accountNumber,
    transactionDate: text(ai.transaction_date),
    needsReview,
  };
}
