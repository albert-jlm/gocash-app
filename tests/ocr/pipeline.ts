/**
 * The replay pipeline: a recorded model response in, a ledger entry out.
 *
 * WHY THIS FILE EXISTS AS A MIRROR
 * --------------------------------
 * The path being tested lives inside `handleProcessTransaction` in
 * `supabase/functions/main/_process_transaction.ts`, which is a single HTTP
 * handler that authenticates a user, uploads an image to storage, calls the
 * OpenAI API, reads fee rules from Postgres, and inserts a row. It cannot be
 * imported and it cannot be called offline.
 *
 * So the FALLBACK GLUE — the eight lines between "the model answered" and
 * "the amount is known" — is mirrored here, verbatim, and marked. Everything
 * downstream of it is the real thing: `detectPlatform`, `detectType` and
 * `extractAccountNumber` are imported from the deployed module, and
 * `calculateFee` / `buildPostings` are imported from `_core`. Nothing in this
 * file re-implements a decision about money.
 *
 * If the glue in `_process_transaction.ts` changes, `assertGlueMatchesSource`
 * in replay.test.ts fails — it reads the deployed file and checks the mirrored
 * lines are still present, so the mirror cannot silently rot.
 */

import {
  detectPlatform,
  detectType,
  extractAccountNumber,
} from "../../supabase/functions/main/_shared/transaction-processing.ts";
import { calculateFee } from "../../supabase/functions/_core/fees.ts";
import { buildPostings } from "../../supabase/functions/_core/postings.ts";
import { toMinor } from "../../supabase/functions/_core/money.ts";
import type { AccountRef, FeeRule, Posting } from "../../supabase/functions/_core/types.ts";
import type { RecordedResponse } from "./types.ts";

/** The fields the Edge Function derives from the model's answer. */
export interface ExtractedFields {
  rawText: string;
  platform: string;
  txType: string;
  /** Whatever `ai.amount ?? 0` produced. NOT coerced — see below. */
  amount: unknown;
  referenceNumber: string | null;
  accountNumber: string | null;
  transactionDate: string | null;
}

/**
 * MIRRORED VERBATIM from _process_transaction.ts, the block immediately after
 * `JSON.parse(completion.choices[0].message.content!)`.
 *
 * Read it as five separate opportunities for a misread to become a posting:
 *
 *   1. `ai.platform !== "Unknown"` — the model's answer is taken on trust. It
 *      is never cross-checked against raw_text, so a confidently wrong
 *      platform drains the wrong wallet and nothing notices.
 *   2. `detectPlatform(rawText)` — first keyword wins, and GCash is tested
 *      first. Any receipt that MENTIONS GCash reads as GCash.
 *   3. `detectType(rawText)` — same first-match-wins, and its final line is
 *      `return "Cash In"`. There is no "I don't know": an unreadable receipt
 *      is silently a Cash In.
 *   4. `ai.amount ?? 0` — a null amount becomes a real transaction worth zero
 *      rather than a rejection.
 *   5. `ai.account_number ?? extractAccountNumber(rawText)` — the operator
 *      blacklist lives inside `extractAccountNumber`, which only runs when the
 *      model answered null. The model's own answer is never blacklist-checked.
 */
export function extractFields(ai: RecordedResponse): ExtractedFields {
  const rawText = ai.raw_text ?? "";

  const platform =
    ai.platform && ai.platform !== "Unknown" ? ai.platform : detectPlatform(rawText);

  const txType =
    ai.transaction_type && ai.transaction_type !== "Unknown"
      ? ai.transaction_type
      : detectType(rawText);

  // `?? 0` and nothing else. No type check, no coercion, no range check. The
  // declared type says `number | null`, which is a claim about the model's
  // output, not a guarantee — JSON.parse will hand back whatever arrived.
  const amount = ai.amount ?? 0;

  const accountNumber = ai.account_number ?? extractAccountNumber(rawText) ?? null;

  // END OF MIRROR.
  return {
    rawText,
    platform,
    txType,
    amount,
    referenceNumber: ai.reference_number ?? null,
    accountNumber,
    transactionDate: ai.transaction_date ?? null,
  };
}

/** The exact source lines the mirror above must keep matching. */
export const MIRRORED_GLUE = [
  'const rawText = ai.raw_text ?? "";',
  'ai.platform && ai.platform !== "Unknown"',
  'ai.transaction_type && ai.transaction_type !== "Unknown"',
  "const amount = ai.amount ?? 0;",
  "ai.account_number ?? extractAccountNumber(rawText) ?? null",
] as const;

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
  const fields = extractFields(ai);

  let amountMinor: number | null = null;
  let feeMinor: number | null = null;

  try {
    // toMinor is the boundary conversion the Edge Function will perform once
    // it writes to the ledger tables, which are integer centavos.
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
