/**
 * THE REPLAY RUNNER.
 *
 * For every fixture: take the recorded model response, push it through the
 * real fallback logic, the real `calculateFee` and the real `buildPostings`,
 * and assert all the way down to a balanced ledger entry with the right sign
 * on every leg.
 *
 * Nothing else in this repo tests that path. `fees.test.ts` proves the fee
 * arithmetic, `postings.test.ts` proves the entries balance, and the SQL
 * suites prove the database enforces the invariant — but every one of them
 * starts from a transaction that is already correct. The step where a misread
 * screenshot BECOMES a transaction has no coverage at all, and that is the
 * step where a misread turns into money moving the wrong way.
 *
 * OFFLINE AND DETERMINISTIC. No network, no database, no API key, no clock,
 * no randomness. The recorded responses are the whole input.
 *
 * KNOWN FAILURES ARE ASSERTED, NOT SKIPPED. A fixture that documents a defect
 * asserts the defect still reproduces exactly, so fixing the pipeline turns
 * this suite red and tells you to delete the marker. A skipped test would let
 * a fix go unnoticed and a regression go unnoticed equally.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { loadCases } from "./loader.ts";
import { legsOf, normaliseLegs } from "./pipeline.ts";
import { effectiveExpectation, evaluate, formatSummary, summarise } from "./report.ts";
import { CUSTOMER_TRANSACTION_TYPES } from "../../supabase/functions/_core/types.ts";
import type { ReplayOutcome } from "./types.ts";

const CASES = loadCases();
const OUTCOMES: ReplayOutcome[] = [];

// ---------------------------------------------------------------------------
// The harness must not drift from the code it claims to test
// ---------------------------------------------------------------------------

describe("the harness is testing the deployed pipeline", () => {
  it("the Edge Function calls the same extractFields this harness replays", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      resolve(here, "../../supabase/functions/main/_process_transaction.ts"),
      "utf8"
    );
    // The harness imports extractFields from _shared/extraction.ts. If the
    // handler stops using it, this suite is measuring code that no longer runs.
    expect(src).toContain('from "./_shared/extraction.ts"');
    expect(src).toContain("extractFields(ai");
    // The defaults that turned "unknown" into a posting must not come back.
    expect(src).not.toContain("ai.amount ?? 0");
    expect(src).not.toContain("transaction_rules");
  });

  it("the model is still pinned by name, so drift is a real risk", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      resolve(here, "../../supabase/functions/main/_process_transaction.ts"),
      "utf8"
    );
    // Not an assertion about which model is right — an assertion that the pin
    // is still a hardcoded literal, which is what makes a nightly live run
    // against these same fixtures necessary. See tests/ocr/README.md.
    expect(src).toContain('model: "gpt-4o"');
  });
});

// ---------------------------------------------------------------------------
// Fixture-set coverage
// ---------------------------------------------------------------------------

describe("the fixture set covers the space", () => {
  it("every fixture is well formed", () => {
    expect(CASES.length).toBeGreaterThan(0);
    for (const c of CASES) {
      expect(c.spec.expected.postings.length, `${c.spec.id}: needs at least 2 legs`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it("all six transaction types appear as a receipt's truth", () => {
    const covered = new Set(CASES.map((c) => c.spec.expected.transaction_type));
    for (const t of CUSTOMER_TRANSACTION_TYPES) {
      expect(covered.has(t), `no fixture whose truth is "${t}"`).toBe(true);
    }
  });

  it("all three platforms appear as a receipt's truth", () => {
    const covered = new Set(CASES.map((c) => c.spec.expected.platform));
    for (const p of ["GCash", "MariBank", "Maya"]) {
      expect(covered.has(p), `no fixture whose truth is "${p}"`).toBe(true);
    }
  });

  it("the expected entry of every fixture balances to exactly zero", () => {
    // The ground truth itself must be arithmetically sound. A fixture whose
    // expected entry does not balance would make the runner assert nonsense.
    for (const c of CASES) {
      const sum = c.spec.expected.postings.reduce((s, l) => s + Math.round(l.php * 100), 0);
      expect(sum, `${c.spec.id}: expected entry sums to ${sum} centavos, not 0`).toBe(0);
    }
  });

  it("each required break case is present", () => {
    const ids = new Set(CASES.map((c) => c.spec.id));
    for (const required of [
      "unknown-platform-falls-back-to-gcash",
      "null-amount-cash-in",
      "missing-reference-number",
      "operator-and-customer-numbers",
      "gcash-cash-out-gross-gate-answered",
    ]) {
      expect(ids.has(required), `missing required fixture: ${required}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The replay
// ---------------------------------------------------------------------------

describe("replay: recorded response -> balanced ledger entry", () => {
  for (const c of CASES) {
    const { spec } = c;
    const label = spec.known_failure
      ? `${spec.id} [KNOWN ${spec.known_failure.kind.toUpperCase()}]`
      : spec.id;

    it(label, () => {
      const outcome = evaluate(c);
      OUTCOMES.push(outcome);

      const want = effectiveExpectation(c);
      const kind = spec.known_failure?.kind;
      const ctx = `${spec.id}\n  probe: ${spec.probe}\n  why:   ${spec.why}`;

      // --- fields ------------------------------------------------------
      expect(outcome.fields.platform.actual, `${ctx}\n  platform`).toBe(want.platform);
      expect(outcome.fields.transaction_type.actual, `${ctx}\n  transaction_type`).toBe(
        want.transaction_type
      );
      expect(outcome.fields.amount.actual, `${ctx}\n  amount`).toStrictEqual(
        want.amount_asserted
      );
      expect(outcome.fields.reference_number.actual, `${ctx}\n  reference_number`).toBe(
        want.reference_number
      );
      expect(outcome.fields.account_number.actual, `${ctx}\n  account_number`).toBe(
        want.account_number
      );

      // --- the entry ---------------------------------------------------
      if (kind === "failed") {
        expect(
          outcome.error,
          `${ctx}\n  expected the pipeline to REFUSE this response, but it produced an entry`
        ).not.toBeNull();
        expect(outcome.postings).toBeNull();
        if (want.error_contains) {
          expect(outcome.error!.message).toContain(want.error_contains);
        }
        return;
      }

      expect(
        outcome.error,
        `${ctx}\n  pipeline threw unexpectedly: ${outcome.error?.message}`
      ).toBeNull();
      expect(outcome.postings, `${ctx}\n  no entry was produced`).not.toBeNull();

      const postings = outcome.postings!;

      // THE INVARIANT. Loud, and checked here as well as inside balanced(),
      // because this is the assertion the whole harness exists to make.
      const sum = postings.reduce((s, p) => s + p.amount, 0);
      expect(
        sum,
        `${ctx}\n  LEDGER ENTRY DOES NOT BALANCE: sum = ${sum} centavos.\n` +
          `  Legs: ${JSON.stringify(legsOf(postings))}`
      ).toBe(0);

      // Every leg, by account, with its sign. Order-insensitive.
      expect(
        legsOf(postings),
        `${ctx}\n  wrong entry — check the SIGN on every leg`
      ).toStrictEqual(normaliseLegs(want.postings));

      expect(outcome.feeMinor, `${ctx}\n  fee`).toBe(Math.round(want.fee_php * 100));

      // --- verdict bookkeeping ----------------------------------------
      if (!kind) {
        expect(
          outcome.entryVerdict,
          `${ctx}\n  this fixture claims no known failure, so the entry must match the ` +
            `receipt's truth exactly`
        ).toBe("ok");
      } else if (kind === "balanced_wrong") {
        expect(
          outcome.entryVerdict,
          `${ctx}\n  this fixture is marked KNOWN balanced_wrong but the pipeline now ` +
            `produces the correct entry. If that is a genuine fix, delete the ` +
            `known_failure block from the fixture.`
        ).toBe("balanced_wrong");
      } else if (kind === "fields_only") {
        expect(
          outcome.entryVerdict,
          `${ctx}\n  this fixture is marked fields_only, meaning the ledger entry must ` +
            `still be correct. It is not — the defect got worse and now moves money.`
        ).toBe("ok");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

afterAll(() => {
  if (OUTCOMES.length === 0) return;
  const s = summarise(CASES, OUTCOMES);
  // Printed, not asserted. The report is for a human to read after the run;
  // the assertions that matter already ran, per fixture, above.
  console.log(formatSummary(CASES, OUTCOMES, s));
});
