# Fixture format

One directory per case. The directory name is the case id.

```
tests/ocr/fixtures/<case-id>/
  response.json     required   the model's answer, verbatim
  case.ts           required   the receipt's truth, plus what this case probes
  meta.json         required   provenance: where the response came from
  screenshot.png    optional   the image the response was recorded from
```

Nothing is registered anywhere. `loader.ts` discovers every directory that has
the three required files, so adding a case is adding a directory. A directory
missing one of the three is an error, not a skip — a silently skipped fixture is
an accuracy number that has quietly stopped covering a case.

---

## `response.json` — the recorded model response

The **verbatim** JSON the model returned: exactly the object that
`JSON.parse(completion.choices[0].message.content)` produces inside
`_process_transaction.ts`. Do not clean it up, reformat the numbers, or fill in
a field the model left out. Its value is being untouched.

```json
{
  "raw_text": "GCash\nSent via GCash\n₱500.00\n…",
  "platform": "GCash",
  "transaction_type": "Cash In",
  "amount": 500,
  "reference_number": "1029384756123",
  "account_number": "09171234567",
  "transaction_date": "2026-09-24T09:41:00+08:00"
}
```

All seven fields are the ones `EXTRACTION_PROMPT` asks for. Every one of them is
optional here, because the model does not always return all of them, and a
fixture that cannot represent a missing field cannot test what happens when one
goes missing. `amount` is deliberately untyped: the model sometimes returns
`"1,250.00"` where a number was asked for, and that case has a fixture.

## `meta.json` — provenance

```json
{
  "source": "synthetic",
  "model": "gpt-4o",
  "recorded_at": "2026-09-24",
  "screenshot": null,
  "note": "Modelled on a standard GCash Send Money confirmation screen."
}
```

| field         | meaning |
|---------------|---------|
| `source`      | `"recorded"` — a real API call on a real screenshot. `"synthetic"` — hand-written to model a real receipt, no image exists. |
| `model`       | The model the response came from, or the model it imitates. |
| `recorded_at` | ISO date. With `model`, this is what lets you tell a model-drift failure from a code regression. |
| `screenshot`  | Filename in this directory, or `null`. |
| `note`        | Where the receipt came from and anything unusual about it. |

**`source` is load-bearing, not bookkeeping.** A synthetic fixture measures the
*pipeline*: given this response, does the right entry come out? It cannot
measure the *model*, because a human decided what the model said. The report
prints the split at the top so that nobody reads a hit rate over synthetic
fixtures as an OCR accuracy figure. Every fixture in this directory is currently
synthetic.

## `screenshot.png` — optional

Absent for every case today. The format is built so an image can be dropped in
beside a response that was recorded from it, without changing anything else:
nothing in the runner reads the image, and nothing ever should. The runner must
stay offline and deterministic, so the image is evidence for a human, not an
input. See `tests/ocr/README.md` for how to record one.

## `case.ts` — the truth and the probe

```ts
/**
 * PROBE: one line — what this fixture is probing.
 *
 * WHY IT BREAKS: the mechanism, named in terms of the code. Which function,
 * which line, why this receipt hits it, and how often that shape of receipt
 * turns up in real use.
 */
import type { OcrCase } from "../../types.ts";

export const CASE: OcrCase = {
  id: "gcash-cash-in-500-clean",          // must equal the directory name
  probe: "…",                             // shown in the report
  why: "…",                               // shown in the report
  gate: { amountIncludesFee: true },      // optional, see below
  expected: { … },
  known_failure: { … },                   // optional, see below
};
```

The block comment is the part a person reads six months from now. It is
required by review, and `probe`/`why` are required by the loader so the report
can print them.

### `expected` — what a careful human reads off the receipt

This is **ground truth**, not current behaviour. If the pipeline gets it wrong,
`expected` still says what is right, and the mistake is recorded separately in
`known_failure`. Writing today's bug into `expected` would turn the fixture into
a description of the defect rather than a test of it.

```ts
expected: {
  platform: "GCash",
  transaction_type: "Cash In",
  amount_php: 500,               // face value in PESOS, or null
  reference_number: "1029384756123",
  account_number: "09171234567", // the CUSTOMER's number. Never the operator's.
  fee_php: 10,                   // per tests/ocr/rules.ts
  postings: [                    // signed PESOS, order does not matter
    { account: "cash",  php:  510 },
    { account: "GCash", php: -500 },
    { account: "revenue", php: -10 },
  ],
}
```

`account` is `"cash"`, `"revenue"`, `"equity"`, or a platform name. The legs must
sum to zero; a fixture whose expected entry does not balance fails the suite
before any replay happens.

Fees come from `tests/ocr/rules.ts` — the defaults a new operator is
provisioned with, 2% with a PHP 5 minimum, held constant across every fixture so
that a pricing change and an accuracy regression cannot be confused.

### `gate` — the operator's answer at the confirmation gate

```ts
gate: { amountIncludesFee: true }
```

Only meaningful on a Cash Out. `calculateFee` will not guess whether a printed
amount is gross or net, because the fact is not on the receipt — see the essay
on `detectGrossAmount` in `_core/fees.ts`. The answer comes from the operator,
and this field stands in for the UI that will ask them. Omit it for the default
(taken at face value).

### `known_failure` — a defect the pipeline has today

```ts
known_failure: {
  kind: "balanced_wrong",   // | "failed" | "fields_only"
  why: "…",                 // the mechanism, in terms of the code
  actual: { … },            // what the pipeline produces TODAY
}
```

| `kind` | meaning |
|--------|---------|
| `balanced_wrong` | An entry was produced, it sums to zero, and it is the wrong entry. The dangerous class — it passes every guard in `postings.ts` and the database's deferred constraint trigger, and becomes the operator's books. |
| `failed` | The pipeline threw. No entry. Loud, and therefore safe. |
| `fields_only` | The entry is correct; a field was misread. Costs nothing today, and becomes money the moment that field is used — see `smart-postpaid-bill-reads-as-telco-load`. |

`actual` accepts `platform`, `transaction_type`, `amount_php`, `amount_raw`
(when the pipeline's amount is not a number at all), `reference_number`,
`account_number`, `fee_php`, `postings`, and `error_contains` (for `failed`).
Fields left out fall back to `expected`.

**A known failure is asserted, never skipped.** The runner checks the defect
still reproduces *exactly*. Fix the pipeline and this suite goes red and tells
you to delete the marker — which is the only way a fix and a regression are
both noticed.

Marking a fixture `known_failure` is not a way to make a red test green. It
records a defect in code this harness does not own (`_process_transaction.ts`
and `_shared/transaction-processing.ts`). Every one currently in this directory
is described in the findings section of `tests/ocr/README.md`.

---

## Adding a case

1. `mkdir tests/ocr/fixtures/<case-id>`
2. Write `response.json` — recorded verbatim, or hand-written and marked
   `"source": "synthetic"`.
3. Write `meta.json`.
4. Write `case.ts`: the probe comment first, then `expected` from the receipt,
   then run it.
5. `npm run test:ocr`. If it fails, decide which is wrong — the fixture or the
   pipeline. If it is the pipeline, add `known_failure` with the mechanism, and
   raise it. Do not change `expected` to match the bug.
