/**
 * UPDATE 2026-11-18: The amount is now parsed exactly from the string ("1,250.00" -> 1250) by extractFields, so the entry is correct.
 * The analysis below describes the behaviour before that change.
 *
 * PROBE: the model returns `amount` as a FORMATTED STRING rather than a
 * number. Everything else on the receipt is read perfectly.
 *
 * WHY IT BREAKS: `response_format: { type: "json_object" }` guarantees the
 * response parses as JSON. It guarantees nothing about types — there is no
 * schema, so "1,250.00" is as valid a value as 1250. The system prompt asks
 * for "plain numbers in PHP (no ₱ symbol, no commas)", and copying the
 * on-screen string is the single most natural thing for a transcription model
 * to do when the whole first step of the prompt is "transcribe ALL visible
 * text verbatim".
 *
 * Nothing validates it. `interface AIExtraction` declares
 * `amount: number | null`, which is a claim about the model's behaviour, not a
 * check on it — `JSON.parse` returns whatever arrived and TypeScript is gone
 * by then. `ai.amount ?? 0` passes the string straight through because a
 * non-empty string is not nullish.
 *
 * KNOWN FAILURE (failed). In the rebuilt pipeline `toMinor` rejects it:
 * `Number.isFinite("1,250.00")` is false because there is no coercion, so it
 * throws and no entry is written. Loud, and the right outcome.
 *
 * Worth recording what the LIVE code does with the same response, because it
 * is the opposite: `calculateProfit` computes "1,250.00" * 0.02 = NaN,
 * Math.ceil(NaN) is NaN, and the row is inserted with a NaN amount and a NaN
 * profit. The rebuild converts a silent poisoning into a visible refusal, and
 * this fixture is the regression lock on that.
 *
 * Migrating off the pinned `gpt-4o` — which this plan flags as inevitable —
 * is exactly when type drift like this shows up, which is the case for having
 * the fixture even though today's model usually gets it right.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "amount-returned-as-formatted-string",
  probe: 'amount returned as the string "1,250.00" instead of the number 1250.',
  why: "JSON mode enforces valid JSON, not a schema. Nothing between JSON.parse and the ledger checks the type.",
  expected: {
    platform: "GCash",
    transaction_type: "Cash In",
    amount_php: 1250,
    reference_number: "1029384756140",
    account_number: "09044351060",
    fee_php: 25,
    postings: [
      { account: "cash", php: 1275 },
      { account: "GCash", php: -1250 },
      { account: "revenue", php: -25 },
    ],
  },
};
