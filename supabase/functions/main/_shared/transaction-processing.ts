
export type TransactionType =
  | "Cash In"
  | "Cash Out"
  | "Telco Load"
  | "Bills Payment"
  | "Bank Transfer"
  | "Profit Remittance";

export type Platform = "GCash" | "MariBank" | "Maya" | "Unknown";

/**
 * Every platform the text names, in a fixed order.
 *
 * "seabank" matters as much as "maribank". SeaBank Philippines, Inc. was
 * renamed MariBank Philippines, Inc. in September 2025 (BSP CL-2025-037), and
 * the Android package is still ph.seabank.seabank. Every screenshot taken
 * before the rebrand says SeaBank.
 */
export function mentionedPlatforms(text: string): Exclude<Platform, "Unknown">[] {
  const t = text.toLowerCase();
  const found: Exclude<Platform, "Unknown">[] = [];
  if (t.includes("gcash") || t.includes("g-cash")) found.push("GCash");
  if (t.includes("maribank") || t.includes("mari bank") || t.includes("seabank")
      || t.includes("sea bank")) found.push("MariBank");
  if (t.includes("maya")) found.push("Maya");
  return found;
}

/**
 * The platform, if the text names exactly one. Otherwise "Unknown".
 *
 * This used to return the first match in a fixed order with GCash tested
 * first, so a MariBank receipt reading "To GCash" came back as GCash and the
 * wrong wallet was debited. Text alone cannot tell the issuer from the
 * destination; when two platforms are named, the operator is asked.
 */
export function detectPlatform(text: string): Platform {
  const found = mentionedPlatforms(text);
  return found.length === 1 ? found[0] : "Unknown";
}

const TYPE_KEYWORDS: readonly [TransactionType, readonly string[]][] = [
  ["Cash In", ["cash in", "cashin", "send money", "you sent", "sent to"]],
  ["Cash Out", ["cash out", "cashout", "you received"]],
  ["Telco Load", [" load", "promo", "globe", "smart", "dito", "tnt", "tm ", "touch mobile"]],
  // "postpaid" and "bill" are here so a postpaid telco bill matches BOTH this
  // and Telco Load, and is asked about instead of being read as a load.
  ["Bills Payment", ["bills", "bill payment", "biller", "paid bill", "postpaid"]],
  ["Bank Transfer", ["bank transfer", "instapay", "pesonet", "transfer to bank"]],
];

/**
 * The transaction type, if the text points to exactly one. Otherwise "Unknown".
 *
 * This used to end in `return "Cash In"`. Cash In and Cash Out are mirror
 * images, so an unreadable Cash Out receipt became a Cash In and every leg of
 * the entry was inverted while still balancing. There is no safe default: no
 * match, or more than one, means the operator is asked.
 */
export function detectType(text: string): TransactionType | "Unknown" {
  const t = text.toLowerCase();
  const found = TYPE_KEYWORDS
    .filter(([, words]) => words.some((w) => t.includes(w)))
    .map(([type]) => type);
  return found.length === 1 ? found[0] : "Unknown";
}

// No numbers live in this file. The shop's own numbers are data
// (gocash.operator_identifiers) and are passed in by the caller. Two of them
// used to be written out here and in the model prompt, in a public repository.

export function extractAccountNumber(
  text: string,
  blacklist: readonly string[] = []
): string | null {
  // Anchored on both sides. Unanchored, this matched the "09…" inside a
  // date-prefixed reference such as MB2409240001987 and invented a customer
  // number for a receipt that had none.
  const matches = text.match(/(?<![\dA-Za-z])(?:\+639|09)\d{9}(?!\d)/g);
  if (!matches) return null;

  for (const raw of matches) {
    const normalized = raw.startsWith("+63") ? "0" + raw.slice(3) : raw;
    if (!blacklist.includes(normalized)) return normalized;
  }

  return null;
}

/** True when `number` is one of the operator's own. */
export function isOperatorNumber(
  number: string,
  blacklist: readonly string[] = []
): boolean {
  const digits = number.replace(/[^\d+]/g, "");
  const normalized = digits.startsWith("+63") ? "0" + digits.slice(3) : digits;
  return blacklist.includes(normalized);
}
