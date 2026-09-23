/**
 * PROBE: a reference number whose leading zeros are dropped. Every other field
 * is perfect and the ledger entry is perfect.
 *
 * WHY IT BREAKS: the prompt describes the reference as "usually 9-13 digits"
 * and "typically starts with digits, 13 characters", which invites the model
 * to treat it as a NUMBER. Numbers do not have leading zeros. This is the
 * classic identifier-as-integer bug, arriving through a model rather than a
 * spreadsheet.
 *
 * KNOWN FAILURE (fields_only). No money moves wrong — and that is precisely
 * why it is worth a fixture, because the reference number is not an accounting
 * field, it is the DUPLICATE KEY:
 *
 *   - `_process_transaction.ts` looks up an existing transaction by
 *     `reference_number` before inserting, and falls back to catching the
 *     unique-violation 23505 on the same column.
 *   - A reference that reads 0029384756123 on Monday and 29384756123 on
 *     Tuesday is two different keys, so the same receipt posts twice and both
 *     entries balance.
 *   - The reverse is worse. Two DIFFERENT receipts that normalise to the same
 *     string collide, and the second one is silently returned as a duplicate
 *     and never recorded at all — a transaction that vanishes with a success
 *     response.
 *
 * Reference accuracy is therefore a money number even though it is not a money
 * field, which is why it is one of the five scored fields in the report.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "reference-number-leading-zeros-dropped",
  probe: "Reference 0029384756123 returned as 29384756123 — leading zeros lost.",
  why: "The prompt describes the reference numerically; the reference is the duplicate key, so a misread defeats dedupe in both directions.",
  expected: {
    platform: "GCash",
    transaction_type: "Cash In",
    amount_php: 400,
    reference_number: "0029384756123",
    account_number: "09178889999",
    fee_php: 8,
    postings: [
      { account: "cash", php: 408 },
      { account: "GCash", php: -400 },
      { account: "revenue", php: -8 },
    ],
  },
  known_failure: {
    kind: "fields_only",
    why:
      "Leading zeros dropped. The ledger entry is correct; the duplicate key is not. " +
      "Re-capturing this receipt posts it a second time, and both entries balance.",
    actual: { reference_number: "29384756123" },
  },
};
