/**
 * Money for GoCash. All amounts are integer CENTAVOS ("minor units").
 *
 * WHY INTEGERS
 * The previous code passed pesos around as floats and reconciled with a
 * round2() helper. Postgres NUMERIC(14,2) sums exactly, so the database was
 * safe, but the TypeScript guard could disagree with it: 339.66 - 333 - 6.66
 * is -3.2e-14 in float64, not 0. A zero-sum check written against floats has
 * to carry an epsilon, and an epsilon is a place for a bug to hide.
 *
 * In centavos every value in this system is an exact integer, the ledger's
 * "must sum to zero" test is `=== 0`, and there is no epsilon anywhere.
 *
 * Convert at the edges only: parse at the API boundary, format for display.
 */

/** An integer number of centavos. 1 peso = 100 minor. */
export type Minor = number;

export const MINOR_PER_UNIT = 100;

/** Largest amount we will accept, matching the Edge Function's validation. */
export const MAX_AMOUNT_MINOR: Minor = 1_000_000 * MINOR_PER_UNIT;

export class MoneyError extends Error {}

function assertSafeInteger(n: number, label: string): void {
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) {
    throw new MoneyError(`${label} must be an integer number of centavos, got ${n}`);
  }
}

/**
 * Pesos (possibly fractional, e.g. from an API payload or an OCR read) to an
 * exact centavo integer.
 *
 * Rounds half away from zero, which is what a person expects: 0.005 -> 0.01.
 * Math.round() alone rounds -0.005 to -0.00, so negatives are handled here.
 */
export function toMinor(pesos: number): Minor {
  if (!Number.isFinite(pesos)) {
    throw new MoneyError(`amount must be a finite number, got ${pesos}`);
  }
  const scaled = pesos * MINOR_PER_UNIT;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  assertSafeInteger(rounded, "amount");
  return rounded;
}

/** Centavos back to pesos. For display and for the DB's NUMERIC(14,2) columns. */
export function toPesos(minor: Minor): number {
  assertSafeInteger(minor, "minor");
  return minor / MINOR_PER_UNIT;
}

/**
 * Round UP to the next whole peso.
 *
 * The live fee logic ends in Math.ceil() for Cash In and Cash Out, so fees on
 * those types are always whole pesos. Preserved exactly.
 */
export function ceilToUnit(minor: number): Minor {
  if (!Number.isFinite(minor)) {
    throw new MoneyError(`cannot round a non-finite value: ${minor}`);
  }
  // Accepts a fractional centavo value on purpose: a fee of amount x 2% is
  // fractional before it is rounded, and rounding is this function's job.
  return Math.ceil(minor / MINOR_PER_UNIT) * MINOR_PER_UNIT;
}

/** "PHP 1,865.00" — used in Telegram messages and any server-rendered text. */
export function formatMinor(minor: Minor): string {
  assertSafeInteger(minor, "minor");
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const units = Math.floor(abs / MINOR_PER_UNIT);
  const cents = abs % MINOR_PER_UNIT;
  const grouped = units.toLocaleString("en-PH");
  return `${negative ? "-" : ""}PHP ${grouped}.${String(cents).padStart(2, "0")}`;
}

/**
 * Parse an amount a person typed into a form, to centavos. Returns null when
 * the text is not an unambiguous peso amount.
 *
 * WHY NOT parseFloat
 * parseFloat reads as far as it can and stops: "1,850" is 1, "12,500.50" is
 * 12, "500abc" is 500. On a confirm screen that turns a pasted or
 * comma-formatted amount into a different, perfectly valid-looking number,
 * and the ledger posts it. An amount that cannot be read exactly must be
 * refused, not approximated.
 *
 * Accepts: "1850", "1850.5", "1,850", "1,850.50", "₱ 1,850", ".50", "0".
 * Rejects: "", "1,85", "1850.505", "1.850,00", "-5", "5e3", "500abc".
 */
export function parsePesosInput(text: string): Minor | null {
  const cleaned = text.replace(/[₱\s]/g, "");
  if (cleaned === "") return null;

  const plain = /^(\d+)?(?:\.(\d{1,2}))?$/;
  const grouped = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;
  const match = plain.exec(cleaned) ?? grouped.exec(cleaned);
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;

  const units = Number((match[1] ?? "0").replace(/,/g, ""));
  const cents = Number((match[2] ?? "0").padEnd(2, "0"));
  const minor = units * MINOR_PER_UNIT + cents;
  return Number.isSafeInteger(minor) ? minor : null;
}
