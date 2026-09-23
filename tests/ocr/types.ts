/**
 * Fixture and result types for the OCR accuracy harness.
 *
 * Nothing here touches the network or the database. The harness is a pure
 * function from a RECORDED model response to a ledger entry, so it can be run
 * offline, in CI, and as many times as you like without spending a token.
 */

import type { Posting } from "../../supabase/functions/_core/types.ts";

/**
 * Exactly the shape `_process_transaction.ts` expects back from the model —
 * `interface AIExtraction` there, copied field for field.
 *
 * Every field is typed loosely (`unknown` for amount) ON PURPOSE. The whole
 * point of this harness is that the model does not always honour the contract:
 * it returns strings where numbers were asked for, omits keys entirely, and
 * answers "Unknown". A strictly-typed mirror would make those cases
 * unrepresentable and the harness would only ever test the happy path.
 */
export interface RecordedResponse {
  raw_text?: string;
  platform?: string;
  transaction_type?: string;
  amount?: unknown;
  reference_number?: string | null;
  account_number?: string | null;
  transaction_date?: string | null;
}

/** Provenance for one recorded response — `meta.json` in the case directory. */
export interface CaseMeta {
  /**
   * "synthetic"  — hand-written to model a real receipt. No screenshot exists.
   * "recorded"   — the verbatim response from a real API call on a real image.
   */
  source: "synthetic" | "recorded";
  /** Model id the response came from, or the model it is written to imitate. */
  model: string;
  /** ISO date the response was recorded / written. */
  recorded_at: string;
  /** Filename of the screenshot in this directory, when one exists. */
  screenshot?: string | null;
  /** Free-text note about where the receipt came from. */
  note?: string;
}

/** One account leg, written the way a human reads it: pesos, signed. */
export interface ExpectedLeg {
  /** "cash", "revenue", "equity", or a platform name such as "GCash". */
  account: string;
  /** Signed PESOS. Positive means the account went up. */
  php: number;
}

/** The ground truth for a receipt: what a careful human reads off the image. */
export interface ExpectedExtraction {
  platform: string;
  transaction_type: string;
  /** Face value in PESOS, or null when the receipt genuinely has no amount. */
  amount_php: number | null;
  reference_number: string | null;
  /** The CUSTOMER's mobile number. Never the operator's. */
  account_number: string | null;
  /** The operator's fee in PESOS, given the fee rules in rules.ts. */
  fee_php: number;
  /** The entry this receipt must produce. Order does not matter. */
  postings: ExpectedLeg[];
}

/**
 * A field the pipeline is known to get wrong, or an entry it is known to
 * mis-post. Declaring it does not excuse it — the runner ASSERTS the failure
 * still reproduces exactly, so if someone fixes the pipeline the test goes red
 * and tells them to delete the marker.
 */
export interface KnownFailure {
  /**
   * "balanced_wrong" — an entry was produced, it sums to zero, and it is not
   *                    the entry the receipt called for. This is the dangerous
   *                    class: nothing downstream can detect it.
   * "failed"         — the pipeline threw. Loud, and therefore much safer.
   * "fields_only"    — the entry is correct but a field was misread. Harmless
   *                    today; becomes money as soon as pricing varies by type
   *                    or the field is used for anything.
   */
  kind: "balanced_wrong" | "failed" | "fields_only";
  /** Why this happens, in terms of the code that causes it. */
  why: string;
  /**
   * What the pipeline actually produces today. Asserted, so this doubles as a
   * regression lock on the defect.
   */
  actual?: {
    platform?: string;
    transaction_type?: string;
    amount_php?: number;
    /**
     * For the case where the pipeline's amount is not a number at all — the
     * model returned a string and nothing coerced it. `amount_php` cannot
     * express that, and typing it loosely would let every fixture be sloppy.
     */
    amount_raw?: unknown;
    reference_number?: string | null;
    account_number?: string | null;
    fee_php?: number;
    postings?: ExpectedLeg[];
    /** Substring the thrown error message must contain, for kind "failed". */
    error_contains?: string;
  };
}

export interface OcrCase {
  /** Must equal the directory name. Checked by the loader. */
  id: string;
  /** One line: what this fixture is probing. */
  probe: string;
  /** Why this case is likely to break, in terms of the code. */
  why: string;
  /**
   * The operator's answer at the confirmation gate, when one is needed.
   *
   * `calculateFee` deliberately refuses to guess whether a Cash Out amount is
   * gross or net (see the essay on `detectGrossAmount` in fees.ts) and takes
   * the answer from the operator instead. Nothing in the OCR response carries
   * that answer, so the harness has to supply it the way the UI will.
   */
  gate?: { amountIncludesFee?: boolean };
  expected: ExpectedExtraction;
  known_failure?: KnownFailure;
}

/** A fixture as the loader hands it to the runner. */
export interface LoadedCase {
  dir: string;
  spec: OcrCase;
  response: RecordedResponse;
  meta: CaseMeta;
}

/** The five fields the accuracy report scores. */
export const SCORED_FIELDS = [
  "platform",
  "transaction_type",
  "amount",
  "reference_number",
  "account_number",
] as const;

export type ScoredField = (typeof SCORED_FIELDS)[number];

/** What the replay produced for one fixture. */
export interface ReplayOutcome {
  id: string;
  /** Field-by-field: did the pipeline's value equal the receipt's truth? */
  fields: Record<ScoredField, { expected: unknown; actual: unknown; hit: boolean }>;
  feeMinor: number | null;
  postings: Posting[] | null;
  error: Error | null;
  /**
   * "ok"             — entry produced and identical to the expected entry.
   * "balanced_wrong" — entry produced, balances, wrong.
   * "failed"         — pipeline threw; no entry at all.
   */
  entryVerdict: "ok" | "balanced_wrong" | "failed";
}
