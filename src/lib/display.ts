/**
 * How things are named and written on screen. One place, so a transaction
 * type is called the same thing on every screen.
 *
 * The stored type names are bookkeeping terms. Two of them misled at the
 * counter: "Profit Remittance" was shortened to "Remit", which reads like a
 * customer's remittance, and the transfer type had three different names
 * across screens.
 */

/** The name shown to the operator for a stored transaction type. */
export const TYPE_NAME: Record<string, string> = {
  "Cash In": "Cash In",
  "Cash Out": "Cash Out",
  "Telco Load": "Load",
  "Bills Payment": "Bills",
  "Bank Transfer": "Bank transfer",
  "Profit Remittance": "Take out profit",
  "Wallet Transfer": "Move my own money",
  "Unknown": "Type not read",
};

export function typeName(type: string | null | undefined): string {
  return TYPE_NAME[type ?? ""] ?? (type || "Type not read");
}

/** What the operator is doing, in their words, so the direction is unambiguous. */
export const TYPE_HINT: Record<string, string> = {
  "Cash In": "Customer hands you cash. Your wallet sends them e-money.",
  "Cash Out": "Customer sends you e-money. You hand them cash.",
  "Telco Load": "Customer hands you cash. You send them load.",
  "Bills Payment": "Customer hands you cash. You pay their bill.",
  "Bank Transfer": "Customer hands you cash. You transfer it to their bank.",
  "Profit Remittance": "You take your earnings out of the drawer. No customer.",
  "Wallet Transfer": "You move your own money between wallets or the drawer. No customer, nothing earned.",
};

/**
 * Format an amount as it is typed: "1850" -> "1,850", "1850.5" -> "1,850.5".
 *
 * Only digits and one decimal point survive, with at most two decimals, so a
 * pasted "₱1,850.00" becomes "1,850.00". Grouping makes a slipped digit
 * visible: 18500 and 1850 look alike until they read 18,500 and 1,850.
 */
export function formatAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  const whole = (firstDot === -1 ? cleaned : cleaned.slice(0, firstDot)).replace(/^0+(?=\d)/, "");
  const decimals = firstDot === -1 ? null : cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimals === null ? grouped : `${grouped || "0"}.${decimals}`;
}
