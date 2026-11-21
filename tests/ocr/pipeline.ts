/**
 * The replay pipeline: a recorded model response in, a ledger entry out.
 *
 * Nothing here re-implements a decision. `extractFields` is the function the
 * Edge Function itself calls (supabase/functions/main/_shared/extraction.ts),
 * and `calculateFee` / `buildPostings` are imported from `_core`. This file
 * used to carry a hand-copied mirror of the handler's extraction glue; the
 * glue now lives in a module both sides import.
 *
 * THE GATE. A draft whose platform, type or amount is unknown cannot be
 * confirmed: the confirm screen leaves the field empty and confirm-transaction
 * refuses it. The replay models that as a refusal ("held at the gate"), which
 * is the safe outcome: no entry is written until a person supplies the field.
 */

import {
  extractFields,
  type ExtractedFields,
} from "../../supabase/functions/main/_shared/extraction.ts";
import { calculateFee } from "../../supabase/functions/_core/fees.ts";
import { buildPostings } from "../../supabase/functions/_core/postings.ts";
import { toMinor } from "../../supabase/functions/_core/money.ts";
import type { AccountRef, FeeRule, Posting } from "../../supabase/functions/_core/types.ts";
import type { RecordedResponse } from "./types.ts";

/**
 * The operator's own numbers in the fixtures. Invented. In the app these come
 * from gocash.operator_identifiers; nothing is hardcoded in the code under test.
 */
export const TEST_OPERATOR_NUMBERS: readonly string[] = ["09990000001"];

export { extractFields };
export type { ExtractedFields };

export interface ReplayResult {
  fields: ExtractedFields;
  /** Centavos, or null if the pipeline threw before the fee was computed. */
  amountMinor: number | null;
  feeMinor: number | null;
  /** The entry, or null if the pipeline threw. */
  postings: Posting[] | null;
  error: Error | null;
}

export interface ReplayOptions {
  rules: readonly FeeRule[];
  /**
   * The operator's answer at the confirmation gate. `calculateFee` will not
   * infer this (fees.ts explains at length why inferring it was wrong roughly
   * one Cash Out in fifty-one), so it has to be passed in. The OCR response
   * carries no signal for it at all — which is itself a finding.
   */
  amountIncludesFee?: boolean;
}

/**
 * Run one recorded response all the way to a balanced ledger entry.
 *
 * Errors are captured rather than thrown so the report can distinguish "the
 * pipeline refused" from "the pipeline produced the wrong entry". The runner
 * still fails loudly on either when the fixture did not declare it.
 */
export function replay(ai: RecordedResponse, opts: ReplayOptions): ReplayResult {
  const fields = extractFields(ai, { ownNumbers: TEST_OPERATOR_NUMBERS });

  let amountMinor: number | null = null;
  let feeMinor: number | null = null;

  try {
    if (fields.needsReview.length > 0) {
      throw new Error(`held at the gate: operator must supply ${fields.needsReview.join(", ")}`);
    }
    amountMinor = toMinor(fields.amount as number);
    feeMinor = calculateFee(fields.txType, fields.platform, amountMinor, opts.rules, {
      amountIncludesFee: opts.amountIncludesFee,
    });
    const postings = buildPostings(fields.txType, {
      amountMinor,
      feeMinor,
      platform: fields.platform,
    });
    return { fields, amountMinor, feeMinor, postings, error: null };
  } catch (e) {
    return {
      fields,
      amountMinor,
      feeMinor,
      postings: null,
      error: e instanceof Error ? e : new Error(String(e)),
    };
  }
}

/** "cash" | "revenue" | "equity" | the platform name. Matches postings.ts. */
export function accountKey(a: AccountRef): string {
  return a.kind === "platform" ? a.platform : a.kind;
}

/** Postings as a sorted `account -> centavos` list, for comparison. */
export function legsOf(postings: readonly Posting[]): { account: string; php: number }[] {
  const byAccount = new Map<string, number>();
  for (const p of postings) {
    const key = accountKey(p.account);
    byAccount.set(key, (byAccount.get(key) ?? 0) + p.amount);
  }
  return [...byAccount.entries()]
    .map(([account, minor]) => ({ account, php: minor / 100 }))
    .sort((a, b) => a.account.localeCompare(b.account));
}

/** Normalise an expected leg list the same way, so the two are comparable. */
export function normaliseLegs(legs: readonly { account: string; php: number }[]) {
  return [...legs]
    .filter((l) => l.php !== 0)
    .sort((a, b) => a.account.localeCompare(b.account));
}
