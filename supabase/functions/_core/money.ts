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
export function ceilToUnit(minor: Minor): Minor {
  assertSafeInteger(minor, "minor");
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
