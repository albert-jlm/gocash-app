# Home Deployment Plan

> Decided 2026-11-18. Scope: the author's own shop only. Wide distribution is on
> hold (see `BLUEPRINT.md` section 8). This replaces the earlier rebuild plan,
> whose file (`~/.claude/plans/i-think-the-whole-async-sparrow.md`) no longer
> exists. Findings referenced here come from the 2026-11-18 evaluation.

Work happens on `feature/ledger-rebuild`. Each fix gets its own commit and a
test. Nothing is merged to `main` until `deploy.yml` is retargeted.

## Step 1 — Money bugs

- [x] A transaction can be posted twice (confirm checks status, posts, then
      updates status; nothing in the database enforces one entry per
      transaction).
- [x] Confirm screen amount parsing: "1,850" saves as 1; a blank amount falls
      back to the AI's figure; the "Your earnings" field is ignored.
- [x] Screenshot drafts still read the dropped `transaction_rules` table, so
      they show ₱0 earnings and never ask whether a Cash Out amount already
      includes the fee.
- [x] AI misreads become entries: unknown type defaults to Cash In, an
      unreadable amount becomes ₱0. Both should ask the operator instead.

## Step 2 — Daily-use gaps

- [x] Void from the transaction screen; remove the "Edit" button that always
      fails.
- [x] Show the result after a drawer reconcile.
- [x] Duplicate screenshot: show the existing transaction, not a dead end.
- [x] Logout button.
- [x] Pending-drafts list on the home screen.

## Step 3 — Sharing a screenshot from the phone (both platforms)

- [ ] **Android:** register the installed web app as a share target (manifest
      entry plus code to receive the shared image), landing on the confirm
      screen.
- [x] **iPhone:** upload keys (Settings → Share from phone) and the
      `share-upload` endpoint. The Shortcut steps are on that screen; the
      operator builds it on the phone. Not yet run from a real iPhone.
- [ ] Written setup steps for Android (after the share target exists).

### Staff logins (added 2026-11-21)

- [x] Owner and staff roles. The owner adds staff by email under Settings →
      Staff; staff record and view, and cannot void, reconcile, change fees or
      wallets, or manage staff. Enforced on the server.

### Receipt reading is local (2026-11-21)

Screenshots are read on the homelab: an OCR service (`~/homelab/gocash/ocr/`,
RapidOCR with the English model, capped at 2 cores) returns the text, and
`supabase/functions/main/_shared/receipt_rules.ts` turns it into fields.
`RECEIPT_READER=local` is the default; `openai` still exists but that account
has no credit. An unrecognised screen is held for the operator; an image with
no receipt on it is refused.

Evidence, on the operator's own screenshots (kept outside this repo in
`~/gocash-receipt-samples/`, with answer keys transcribed by eye):

- Engines compared on 47 screenshots, as-is, colour-inverted and
  shrunk-and-JPEG: RapidOCR read every amount, reference and date in all
  three; Tesseract dropped 2–5 dates and references; EasyOCR was slower and
  missed amounts; Baidu's PP-OCRv6 (tiny and small) tied RapidOCR.
- Rules: a second batch of 23 was read before anyone looked at it. Nothing was
  filled in wrong; 5 fields were left empty, from two layouts since added.
  All 53 supported receipts in both sets now read correctly, with either
  RapidOCR model. `pnpm run test:ocr` reruns this where the samples exist.

Known limits: no real dark-mode sample (it was simulated); no GCash load,
GCash bills or GCash cash-in-from-bank sample; bank apps (BPI, RCBC) are not
recognised and come back for the operator to fill in.

### Next: transfers between the shop's own wallets

Decided 2026-11-21. A screenshot shows which way money moved, not why. Moving
float between the shop's own wallets is common and must not be recorded as a
customer transaction with a fee.

- [x] Transaction type "Wallet Transfer": source down, destination up, no
      earnings. Covers wallet to wallet, wallet to drawer, drawer to wallet.
      Entered from the "Move" tile, or by changing a draft's type on the
      review screen. (2026-11-21)
- [x] A platform's fee for the move is its own cost account ("Transfer
      Costs"). It does NOT reduce earnings. (2026-11-21)
- [x] A list of the shop's own numbers and accounts (Settings → My numbers &
      accounts, owner only), so a receipt whose other side is one of them is
      read as a transfer between the right two wallets. The two phone numbers
      that were hardcoded in the code and the model prompt are gone; the list
      is what keeps an own number from being saved as a customer's. (2026-11-21)
- [x] The second screenshot of the same transfer (same route, same money,
      within 15 minutes) is recognised as its other half and not recorded
      again. (2026-11-21)
- [ ] Not yet exercised with a real transfer on the live stack: the logic is
      covered by tests and by an offline run over the private samples.
- The shop's own bills, paid from a shop wallet, are ordinary Bills Payments
  at the normal fee. No special handling.

## Step 4 — Deploy at home

Access (decided 2026-11-18): the app and its backend stay reachable from the
public internet, not Tailscale-only, so the phones work anywhere.

- [x] Add the missing schema and table grants to the migrations.
- [x] Start the dedicated stack in `~/homelab/gocash/` (secrets, `.env`).
- [x] Load the schema (2026-11-20). The login account exists.
- [ ] Add `gocash-api.zether.net` to the Cloudflare tunnel (operator, in the
      dashboard): Public Hostname -> service `http://traefik:80`.
- [ ] First sign-in and onboarding: the operator enters the opening balances.
- [x] Point the site at the new stack. `out/` was rebuilt against
      `https://gocash-api.zether.net`; it cannot sign in until the hostname
      above exists.
- [x] Confirm the backup covers the new database.

### How the home stack is laid out

`~/homelab/gocash/`: `docker-compose.yml` (db, rest, auth, storage, functions
and an nginx gateway that provides the `/rest/v1`, `/auth/v1`, `/storage/v1`
and `/functions/v1` prefixes), `.env` (secrets, never committed), `psql.sh`,
`apply-migrations.sh`. The functions container mounts this repo's
`supabase/functions` read-only, so the checked-out branch is what runs.
Migrations are applied by hand with `psql.sh`; there is no tracking table yet.
The nightly backup dumps the database (`dump_pg gocash gocash-db`).

## Not now

- Merging the 35 commits on `main` (Google sign-in, filters, toasts).
- Native iOS/Android builds.
- Moving the operator's phone numbers into a per-operator table.
- Receipt retention rules.
- Signup, billing, anything multi-operator.

## Open question — how receipts are read

Raised 2026-11-18: replace OpenAI GPT-4o with local OCR on the homelab plus
fixed parsing rules per receipt type, keeping OpenAI as an optional fallback
that is off by default. Reasons: per-screenshot cost, dependence on an outside
service, and customer details leaving the server.

Not decided. It needs measuring on real receipts first, using the replay
harness in `tests/ocr`. Public sample screenshots turned out to be too few and
too old to build rules from; the operator is collecting their own. This sits
between step 2 and step 3, since phone sharing depends on how the image is
read.
