# OCR accuracy harness

The money model is being rebuilt with care. Its **input has no error bar**.

`EXTRACTION_PROMPT` in `supabase/functions/main/_process_transaction.ts` was
tuned against one operator's receipts and has never been measured. Everything
downstream of it is now tested — `fees.test.ts` pins every branch of the
pricing, `postings.test.ts` asserts the sign of every leg, and the SQL suites
prove the database enforces the zero-sum invariant — but every one of those
suites starts from a transaction that is *already correct*. The step where a
misread screenshot **becomes** a transaction had no coverage at all, and that is
the step where a misread turns into money moving the wrong way.

This harness covers that step. It replays recorded model responses through the
real fallback logic, the real `calculateFee` and the real `buildPostings`, and
asserts all the way down to a balanced ledger entry with the right sign on every
leg.

```
npm run test:ocr          # this suite, with the accuracy report
npm test                  # the whole vitest suite, this included
```

Offline, deterministic, no network, no database, no API key, no clock. The
recorded responses are the entire input. **It never calls the OpenAI API.**

---

## What is here

| file | what it is |
|---|---|
| `fixtures/` | One directory per case. Format documented in `fixtures/README.md`. |
| `pipeline.ts` | Recorded response → ledger entry. The extraction glue is mirrored from the Edge Function; everything downstream is imported from the real modules. |
| `rules.ts` | The fee rules every fixture is priced against — the provisioning defaults, 2% / PHP 5. |
| `loader.ts` | Fixture discovery. Drop in a directory, it is a fixture. |
| `report.ts` | Per-field hit rate and the entry-verdict split. |
| `replay.test.ts` | The runner. |

### Why `pipeline.ts` is a mirror

The path under test lives inside `handleProcessTransaction`, a single HTTP
handler that authenticates a user, uploads to storage, calls OpenAI, reads fee
rules from Postgres and inserts a row. It cannot be imported and it cannot run
offline.

So the eight lines of glue between "the model answered" and "the amount is
known" are copied into `pipeline.ts`, verbatim and marked. Everything else is
the real thing: `detectPlatform`, `detectType` and `extractAccountNumber` are
imported from the deployed module, and `calculateFee` and `buildPostings` from
`_core`. Nothing in the harness re-implements a decision about money.

A test in `replay.test.ts` reads `_process_transaction.ts` and asserts the
mirrored lines are still present, so the mirror cannot silently rot. If that
test fails, the Edge Function changed and the mirror needs updating — the
harness is otherwise measuring code that no longer runs.

---

## Reading the report

Two numbers, answering different questions.

**Per-field hit rate** — how often each field was read correctly. This is the
error bar the money model has never had. `reference_number` is scored even
though it is not an accounting field, because it is the only duplicate key the
system has.

**Entry verdict** — what the misreads *did* once they reached the ledger:

- `correct entry` — matches the receipt.
- `BALANCED BUT WRONG` — sums to zero, passes every guard in `postings.ts` and
  the database's deferred constraint trigger, and is the wrong entry. **This is
  the class that matters.** A sign error is still a zero sum, so the invariant
  this rebuild added to catch bad money cannot see it at all.
- `failed outright` — the pipeline threw; no entry. Loud, and therefore safe.

Averaging those into one accuracy percentage would hide the only distinction
worth having. An entry that fails costs a retry. An entry that balances and is
wrong becomes the operator's books.

Unbalanced entries are not a category: the runner throws on one.

---

## The number today

22 fixtures, all synthetic, so this measures the **pipeline**, not the model:

```
platform           21/22   95.5%
transaction_type   19/22   86.4%
amount             19/22   86.4%
reference_number   21/22   95.5%
account_number     20/22   90.9%

correct entry      15/22
BALANCED BUT WRONG  5/22
failed outright     2/22
```

**These are not OCR accuracy figures and must not be quoted as such.** A human
decided what the model said in every one of these fixtures. The denominator is
a deliberately adversarial set — roughly half the fixtures were written to hit a
specific weakness — so the percentages describe the fixture set, not a day's
receipts. What they do measure is real: given these responses, this is what
reaches the ledger.

Getting a real number means recording responses from real screenshots. That is
the next section.

---

## Adding a real screenshot

This is the path from "no error bar" to one.

1. **Get consent and scrub.** A receipt carries a customer's name and mobile
   number. Either use the operator's own test transactions, or get explicit
   permission and redact the customer's name in the image before it goes into
   the repo. The mobile number usually has to stay — it is what
   `account_number` extraction is being tested on — so prefer test
   transactions to a real customer's receipt wherever the case allows it.

2. **Record the response once.** Call the model with the *same* system prompt,
   extraction prompt, model id and parameters as the Edge Function:
   `model: "gpt-4o"`, `response_format: { type: "json_object" }`,
   `max_tokens: 600`, image first with `detail: "high"`, then the text.
   Anything that differs makes the recording measure something other than
   production. Save the raw `choices[0].message.content`, parsed but otherwise
   untouched, as `response.json`.

3. **Create the directory.**

   ```
   tests/ocr/fixtures/<case-id>/
     screenshot.png     the image, scrubbed
     response.json      what the model said, verbatim
     meta.json          { "source": "recorded", "model": "gpt-4o",
                          "recorded_at": "…", "screenshot": "screenshot.png" }
     case.ts            the probe comment, and the truth you read off the image
   ```

4. **Write `expected` from the image, not from the response.** This is the
   whole exercise. If you copy the model's answer into `expected`, the fixture
   asserts that the model agrees with itself and measures nothing.

5. `npm run test:ocr`. A failure is information: decide whether the fixture or
   the pipeline is wrong, and if it is the pipeline, add `known_failure` with
   the mechanism rather than editing `expected`.

Format details are in `fixtures/README.md`. The runner never reads the image —
it is evidence for a human, and the suite must stay offline.

**Twenty recorded fixtures from a second operator's receipts would tell you
more about product risk than anything else on the roadmap.** The extraction is
tuned to one operator; nobody knows what it does on another's. Selling a second
seat before that number exists is the risk this harness was built to make
visible.

---

## The nightly drift job

**Not built. Do not build it without reading this section.** The instructions
are here so that whoever builds it builds the right thing.

### Why it is needed

The model is pinned by name, as a hardcoded literal:

```ts
const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  …
```

`gpt-4o` is an alias, not an immutable snapshot. It will be repointed, and it
will eventually be deprecated. Neither event produces an error — the extraction
just starts behaving differently, and the first symptom is an operator's books
being wrong. `replay.test.ts` asserts the pin is still a literal, so that this
stays visible.

### What it should do

For each fixture that has a `screenshot` in its `meta.json`:

1. Send the image to the live API with the *exact* production prompt and
   parameters, as in step 2 above.
2. Diff the live response against the recorded `response.json`, **field by
   field**. Not a string diff — `raw_text` will differ in whitespace on every
   call and that is noise.
3. Replay the live response through this same harness (`evaluate()` in
   `report.ts` takes a response and a fixture) and diff the resulting *ledger
   entry* against the recorded one.
4. Alert on: any change in `platform`, `transaction_type` or `amount`; any
   change in the entry; any fixture moving between verdict classes. A changed
   `raw_text` alone is not an alert.

### How it should be wired

- **Nightly, on a schedule, never in CI on a pull request.** Every run costs
  money and the result is not deterministic, so it cannot gate a merge. Keep
  `npm run test:ocr` as the thing CI runs — it stays offline and free.
- **Its own entry point**, e.g. `tests/ocr/live/` with its own npm script. It
  must not be picked up by `vitest run`, or a plain `npm test` starts spending
  tokens.
- **Read the key from the environment**, fail with a clear message when it is
  absent, and never commit it.
- **Never overwrite `response.json` automatically.** A drift job that heals
  itself detects nothing. When drift is real and accepted, a human re-records
  and bumps `model` and `recorded_at` in `meta.json` in a reviewable commit.
- Alert on a *material* diff only. A model that returns `"09171234567"` where
  it used to return `"+639171234567"` is drift worth seeing; one that
  transcribes a line break differently is not.

### The migration it exists to serve

When `gpt-4o` is replaced, the fixture set is the acceptance test for the
replacement: run the same screenshots through the candidate, replay both, and
compare the two accuracy reports. That is a decision made on a number instead
of a vibe, and it is the reason to record real screenshots now rather than on
the day the deprecation notice arrives.

---

## Findings

Every one of these is a defect in code this harness does not own —
`_process_transaction.ts` and `_shared/transaction-processing.ts`. Each is
recorded as a `known_failure` in the named fixture and **asserted**, so if one
is fixed this suite goes red and says so.

### Balanced but wrong — the entry sums to zero and the money is wrong

**1. `detectType` has no "unknown", and its default is `Cash In`.**
`maribank-bare-receipt-defaults-to-cash-in`. MariBank's success screen says
"Successful" and an amount and nothing else. The model honestly returns
`"Unknown"`, `detectType` falls through every keyword branch and returns
`"Cash In"`. The truth was a Cash Out. Cash In and Cash Out are mirror images,
so the direction does not shade the entry, it inverts it: cash goes `+1,020`
instead of `-980` and the wallet `-1,000` instead of `+1,000`. **PHP 2,000 of
error on a PHP 1,000 receipt, in a perfectly balanced entry.** The only thing
between this and the books is whether a human notices "Cash In" on the
confirmation screen. *Severity: highest in the set.*

**2. Profit Remittance is unreachable from capture.**
`profit-remittance-unreachable`. The prompt's enum offers Cash In, Cash Out,
Telco Load, Bills Payment, Bank Transfer, Unknown — **"Profit Remittance" is not
an option**, and a model in JSON mode cannot return a value it was not offered.
`detectType` has no branch for it either. One of the six types the ledger
supports cannot be produced, and it is the one where the operator takes money
*out* of the business. Photographing the nearest thing books the drawer `+5,100`
when PHP 5,000 physically left it — a PHP 10,100 swing — invents PHP 100 of
revenue, and never moves equity. Drawings are recorded as customer business, so
profitability is overstated.

**3. `ai.amount ?? 0` turns "I could not read it" into "it was zero".**
`null-amount-cash-in`. The system prompt says "Never guess amounts", the model
obeys and returns null, and the glue converts the refusal into a confident
zero. The PHP 5 fee floor then produces `cash +5 / revenue -5`: two legs, sums
to zero, passes every guard. PHP 5 of revenue is invented, the drawer is
credited money nobody handed over, and the PHP 1,200 that actually moved is
never recorded. **The prompt's most careful instruction produces the least
detectable corruption.** The same response on a Cash Out
(`null-amount-cash-out`) throws instead, because the fee exceeds the amount —
identical cause, opposite severity, and the difference is an accident of which
builder the type dispatched to, not a safety design.

**4. `detectPlatform` scans in platform order, not text order.**
`maribank-to-gcash-platform-hijack`. GCash is tested first, so any receipt that
so much as *mentions* GCash reads as GCash — including a MariBank receipt
sending to a customer's GCash account. Cross-wallet transfers are routine for an
operator running three wallets, and GCash is the wallet every customer has, so
it is the platform most likely to appear as the *destination* on someone else's
receipt. The entry balances and every sign is right; the wrong wallet is
drained. Two wallet balances end up wrong by equal and opposite amounts, with
nothing to indicate why.

**5. Nothing asks whether a Cash Out amount is gross.**
`maya-cash-out-gross-gate-missed`. A customer who wants PHP 5,000 sends 5,100 to
cover the fee, and the receipt says 5,100 and nothing else. `calculateFee`
correctly refuses to guess — the old guess was wrong on every amount divisible
by 51 — and takes the answer from the operator instead. But **the OCR response
carries no field that could feed that gate**, and `detectGrossAmount`, which
exists precisely to raise the question, is never called by
`_process_transaction.ts`. Default behaviour charges fee-on-fee: the customer is
handed 4,998 instead of 5,000, at the counter, in front of the operator. Small,
invisible, and on every gross cash out.

### Correct ledger, misread field — costs nothing today

**6. The operator blacklist is bypassed by `??`.**
`operator-number-returned-by-model`. The glue is
`ai.account_number ?? extractAccountNumber(rawText) ?? null`, and the blacklist
lives *inside* `extractAccountNumber`. A confident wrong answer from the model
short-circuits the only safeguard there is. The prompt does say "Operator
blacklist (never use)", but a prompt is a request, not a constraint — and the
operator's number sits in the account header in large type while the customer's
is small text in the body. Every transaction then files under the operator's own
number.

Related, in `operator-and-customer-numbers`: one of the two hardcoded blacklist
entries, `"13990000002"`, **cannot ever match the regex** — it starts with "13".
Half the defence is dead code. The blacklist is also a literal in the source,
not operator data, so a second operator's number cannot be blacklisted at all
without a deploy.

**7. `extractAccountNumber`'s regex is unanchored and fabricates numbers.**
`reference-digits-read-as-mobile-number`. `/(?:\+639|09)\d{9}/g` has no word
boundaries and no context, so it matches `09022362733` inside the reference
`MB2409240001987` and returns it as the customer's mobile — on a receipt with no
mobile number anywhere on it. Date-prefixed references are the standard shape
for Philippine bank and e-wallet references, and any reference generated in
month 09 puts an "09" in a long digit run. The fallback is at its most dangerous
exactly when it should decline. A fabricated number looks like real data: it
appears in customer history, it can be dialled, and it can collide with a real
customer's.

This one was found **by accident**. `maribank-bank-transfer-instapay` was
written to test something else, with the first realistic MariBank reference that
came to mind, and the runner failed it immediately. That fixture's reference was
changed to keep its probe clean and the defect was given its own fixture. The
accident is the evidence: it fires on the first realistic reference tried.

**8. Telco brand names outrank the Bills Payment branch.**
`smart-postpaid-bill-reads-as-telco-load`. `detectType` tests `"smart"` before
it tests `"bills"`, and a Smart *postpaid bill* contains "smart" and never
contains "bills". Every postpaid bill from Globe, Smart, DITO or TNT is
classified as a load purchase. The ledger is **identical today**, because both
types share one `platform: "all"` rule and the same posting shape — which is the
trap. It becomes real money the moment `fee_rules` prices the two types
differently, which is exactly what `fee_rules` was built to allow. Per-type
reporting is wrong from today.

**9. Reference numbers are described numerically, so leading zeros are lost.**
`reference-number-leading-zeros-dropped`. The prompt calls the reference
"usually 9-13 digits", inviting the model to normalise it as a number.
`0029384756123` comes back as `29384756123`. No money moves wrong — and the
reference is the *duplicate key*: `_process_transaction.ts` looks up an existing
transaction by it and falls back to catching the unique violation on the same
column. A reference that reads one way on Monday and another on Tuesday means
the same receipt posts twice and both entries balance. The reverse is worse: two
different receipts that normalise to the same string collide, and the second is
silently returned as a duplicate and **never recorded at all** — a transaction
that vanishes behind a success response.

### Adjacent observations, not asserted

- **A null reference silently disables duplicate detection.**
  `missing-reference-number` passes — the model correctly returns null because
  the reference is not on screen, and the entry is perfect. But the duplicate
  lookup is skipped entirely when the reference is falsy, and a unique
  constraint cannot fire on NULL. Cropping above the reference line is the most
  common capture mistake an operator makes, which puts this on the hot path.
  Scored as a hit, because it is a correct read; recorded here because the
  consequence is not.

- **Nothing validates the platform before it becomes a posting.**
  `buildPostings` will create a leg against a platform literally named
  `"Unknown"`, with no check against the operator's `operator_platforms` rows.
  The legacy `computeWalletDeltas` at least mapped Unknown to GCash; the
  rebuilt path has no such mapping, so this is a new gap rather than an
  inherited one. `paymaya-alias-platform-fallback` covers the alias list that
  currently prevents it.

- **Profit Remittance has a fee rule that goes nowhere.** The provisioning seed
  gives it a 2% / PHP 5 rule; `profitRemittance()` takes no fee argument and
  silently ignores one. Harmless while the type is unreachable, which is a
  poor reason for it to be safe.

- **JSON mode is not a schema.** `response_format: { type: "json_object" }`
  guarantees the response parses, and nothing more. `interface AIExtraction` is
  a claim about the model's behaviour, not a check on it, and TypeScript is
  gone by the time `JSON.parse` returns. `amount-returned-as-formatted-string`
  shows the consequence: the rebuilt pipeline throws on `"1,250.00"`, while the
  live `calculateProfit` computes NaN and inserts the row. The rebuild turned a
  silent poisoning into a visible refusal; the fixture is the lock on that.

---

## What this harness cannot cover without real screenshots

Honestly: the half that matters most. Everything above tests what the
**pipeline** does with a given response. None of it tests what the **model**
does with a given image, because a human wrote every response here.

Specifically out of reach:

- **Transcription accuracy itself.** Whether `raw_text` actually contains what
  is on the screen. Every fallback in this system — platform, type, account
  number — reads `raw_text`, so a transcription error propagates into all three
  at once. A synthetic fixture cannot exhibit that, because its `raw_text` is
  correct by construction.
- **Digit-level misreads.** 8 vs 3, 1 vs 7, 0 vs 8 in an amount or a reference,
  which is where real OCR fails and where a PHP 1,000 becomes a PHP 7,000. A
  hand-written response can assert a *wrong* amount but cannot tell you how
  often one occurs.
- **The real distribution of failures.** These 22 fixtures are adversarial by
  design. Whether `platform: "Unknown"` happens on 1% of receipts or 20% is
  unknown, and it decides whether the fallback defects above are theoretical or
  daily.
- **Anything about a second operator's receipts** — different app versions,
  different languages and dialects in the receipt chrome, different themes,
  screenshots of screenshots, receipts photographed off another phone's screen.
  This is the risk the whole exercise is about, and it needs their images.
- **Image-quality failure modes.** Glare, motion blur, low light, partial
  crops, rotation, aggressive messaging-app compression. The fixtures *say* "the
  amount was blurred"; only a real blurred image tests it.
- **Model non-determinism.** The same image can produce different answers on
  different calls. Recorded fixtures capture one sample; the drift job above is
  the only way to see the spread.
- **Multi-transaction screenshots.** A transaction-history screen showing five
  rows. The prompt assumes one transaction per image and has no way to say
  "there are five here". Untested, and unrepresentable in this format as it
  stands.
