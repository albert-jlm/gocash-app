/**
 * The accuracy report.
 *
 * Two numbers, and they answer different questions:
 *
 *   PER-FIELD HIT RATE — how often the OCR read each field correctly. This is
 *   the error bar the money model has never had. Without it, "the extraction
 *   is tuned to one operator's receipts" is a feeling, not a measurement, and
 *   there is no way to tell whether a second operator's receipts are worse.
 *
 *   ENTRY VERDICT — what the misreads DID once they reached the ledger, split
 *   into "produced a balanced but wrong entry" and "failed outright". The
 *   split is the point. An entry that fails is loud and costs a retry. An
 *   entry that balances and is wrong passes every guard in postings.ts and the
 *   deferred constraint trigger in the database, and becomes the operator's
 *   books. Averaging the two into one accuracy percentage would hide the only
 *   distinction that matters.
 */

import { legsOf, normaliseLegs, replay } from "./pipeline.ts";
import { DEFAULT_FEE_RULES } from "./rules.ts";
import {
  SCORED_FIELDS,
  type LoadedCase,
  type ReplayOutcome,
  type ScoredField,
} from "./types.ts";

/** Effective expectation: the receipt's truth, overlaid with any known defect. */
export function effectiveExpectation(c: LoadedCase) {
  const e = c.spec.expected;
  const k = c.spec.known_failure?.actual ?? {};
  return {
    platform: k.platform ?? e.platform,
    transaction_type: k.transaction_type ?? e.transaction_type,
    amount_php: k.amount_php ?? e.amount_php,
    amount_asserted: "amount_raw" in k ? k.amount_raw : (k.amount_php ?? e.amount_php),
    reference_number: "reference_number" in k ? k.reference_number! : e.reference_number,
    account_number: "account_number" in k ? k.account_number! : e.account_number,
    fee_php: k.fee_php ?? e.fee_php,
    postings: k.postings ?? e.postings,
    error_contains: k.error_contains,
  };
}

/** Run one fixture and score it against the receipt's TRUTH (not the defect). */
export function evaluate(c: LoadedCase): ReplayOutcome {
  const r = replay(c.response, {
    rules: DEFAULT_FEE_RULES,
    amountIncludesFee: c.spec.gate?.amountIncludesFee,
  });

  const truth = c.spec.expected;
  const actualAmount = r.amountMinor !== null ? r.amountMinor / 100 : r.fields.amount;

  const actualByField: Record<ScoredField, unknown> = {
    platform: r.fields.platform,
    transaction_type: r.fields.txType,
    amount: actualAmount,
    reference_number: r.fields.referenceNumber,
    account_number: r.fields.accountNumber,
  };
  const expectedByField: Record<ScoredField, unknown> = {
    platform: truth.platform,
    transaction_type: truth.transaction_type,
    amount: truth.amount_php,
    reference_number: truth.reference_number,
    account_number: truth.account_number,
  };

  const fields = {} as ReplayOutcome["fields"];
  for (const f of SCORED_FIELDS) {
    fields[f] = {
      expected: expectedByField[f],
      actual: actualByField[f],
      hit: Object.is(expectedByField[f], actualByField[f]),
    };
  }

  let entryVerdict: ReplayOutcome["entryVerdict"];
  if (r.postings === null) {
    entryVerdict = "failed";
  } else {
    const got = JSON.stringify(legsOf(r.postings));
    const want = JSON.stringify(normaliseLegs(truth.postings));
    entryVerdict = got === want ? "ok" : "balanced_wrong";
  }

  return {
    id: c.spec.id,
    fields,
    feeMinor: r.feeMinor,
    postings: r.postings,
    error: r.error,
    entryVerdict,
  };
}

export interface Summary {
  total: number;
  perField: Record<ScoredField, { hits: number; total: number }>;
  verdicts: { ok: number; balanced_wrong: number; failed: number };
  /** Fixtures whose defect is recorded in the fixture itself. */
  known: number;
  /** Ids by verdict, so the summary can name names. */
  wrongIds: string[];
  failedIds: string[];
}

export function summarise(cases: LoadedCase[], outcomes: ReplayOutcome[]): Summary {
  const perField = Object.fromEntries(
    SCORED_FIELDS.map((f) => [f, { hits: 0, total: 0 }])
  ) as Summary["perField"];

  const verdicts = { ok: 0, balanced_wrong: 0, failed: 0 };
  const wrongIds: string[] = [];
  const failedIds: string[] = [];

  for (const o of outcomes) {
    for (const f of SCORED_FIELDS) {
      perField[f].total += 1;
      if (o.fields[f].hit) perField[f].hits += 1;
    }
    verdicts[o.entryVerdict] += 1;
    if (o.entryVerdict === "balanced_wrong") wrongIds.push(o.id);
    if (o.entryVerdict === "failed") failedIds.push(o.id);
  }

  return {
    total: outcomes.length,
    perField,
    verdicts,
    known: cases.filter((c) => c.spec.known_failure).length,
    wrongIds,
    failedIds,
  };
}

const pct = (h: number, t: number) => (t === 0 ? "n/a" : `${((h / t) * 100).toFixed(1)}%`);
const bar = (h: number, t: number, width = 20) =>
  "#".repeat(Math.round((h / t) * width)).padEnd(width, ".");

/** A summary a human reads, not a machine. */
export function formatSummary(
  cases: LoadedCase[],
  outcomes: ReplayOutcome[],
  s: Summary
): string {
  const L: string[] = [];
  const rule = "-".repeat(72);

  L.push("");
  L.push("=".repeat(72));
  L.push(`OCR ACCURACY — ${s.total} fixtures, replayed offline against recorded responses`);
  L.push("=".repeat(72));

  const recorded = cases.filter((c) => c.meta.source === "recorded").length;
  L.push(
    `Provenance: ${recorded} recorded from real screenshots, ` +
      `${s.total - recorded} synthetic. Synthetic fixtures measure the PIPELINE, not the`
  );
  L.push(
    "model. A real accuracy number needs recorded responses — see tests/ocr/README.md."
  );

  L.push("");
  L.push("PER-FIELD HIT RATE");
  L.push(rule);
  for (const f of SCORED_FIELDS) {
    const { hits, total } = s.perField[f];
    L.push(
      `  ${f.padEnd(19)} ${String(hits).padStart(2)}/${total}  ` +
        `${pct(hits, total).padStart(6)}  ${bar(hits, total)}`
    );
  }

  L.push("");
  L.push("WHAT THE MISREADS DID TO THE LEDGER");
  L.push(rule);
  L.push(`  correct entry              ${String(s.verdicts.ok).padStart(2)}/${s.total}`);
  L.push(
    `  BALANCED BUT WRONG         ${String(s.verdicts.balanced_wrong).padStart(2)}/${s.total}` +
      "   <- sums to zero, passes every guard, wrong money"
  );
  L.push(
    `  failed outright            ${String(s.verdicts.failed).padStart(2)}/${s.total}` +
      "   <- no entry written; loud, and therefore safe"
  );
  L.push("");
  L.push(`  ${s.known} of ${s.total} fixtures carry a documented known failure.`);
  L.push("  Unbalanced entries: 0 — the runner throws on one rather than counting it.");

  if (s.wrongIds.length) {
    L.push("");
    L.push("BALANCED BUT WRONG — every one of these is a real defect");
    L.push(rule);
    for (const id of s.wrongIds) {
      const c = cases.find((x) => x.spec.id === id)!;
      L.push(`  ${id}`);
      L.push(`      ${c.spec.why}`);
    }
  }

  if (s.failedIds.length) {
    L.push("");
    L.push("FAILED OUTRIGHT");
    L.push(rule);
    for (const id of s.failedIds) {
      const o = outcomes.find((x) => x.id === id)!;
      L.push(`  ${id}`);
      L.push(`      ${o.error?.message ?? "(no message)"}`);
    }
  }

  const fieldOnly = cases.filter((c) => c.spec.known_failure?.kind === "fields_only");
  if (fieldOnly.length) {
    L.push("");
    L.push("CORRECT LEDGER, MISREAD FIELD — invisible today, money later");
    L.push(rule);
    for (const c of fieldOnly) {
      L.push(`  ${c.spec.id}`);
      L.push(`      ${c.spec.why}`);
    }
  }

  L.push("");
  L.push("=".repeat(72));
  L.push("");
  return L.join("\n");
}
