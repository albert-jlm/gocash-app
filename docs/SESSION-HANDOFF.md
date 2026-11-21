# Where things stand (handoff, 2026-11-21)

Read this first when picking the work up. `docs/home-deployment-plan.md` has
the plan and its history; `BLUEPRINT.md` has the purpose. This file is the
short version of what is live, what is waiting on the operator, and what is
next.

## Live now

- **Site:** gocash.zether.net, host nginx serving `~/gocash-app/out`
  (a `next build` in this repo deploys it).
- **Backend:** its own stack in `~/homelab/gocash/` (db, rest, auth, storage,
  functions, ocr, nginx gateway), public at gocash-api.zether.net through
  Traefik and the Cloudflare tunnel. The functions container mounts this
  repo's `supabase/functions`, so the checked-out branch is the running code.
  Restart `gocash-functions` after changing functions, `gocash-rest` after
  schema changes. Migrations are applied by hand with `./psql.sh`.
- **Receipt reading:** local. OCR service (RapidOCR, English model, capped at
  2 CPUs) plus rules in `supabase/functions/main/_shared/receipt_rules.ts`.
  The OpenAI account has no credit; `RECEIPT_READER=openai` is not usable.
- **Features:** typed entry, screenshot upload, review and confirm, void,
  drawer reconcile, wallets add/remove, staff with owner/staff roles, upload
  keys and the `share-upload` endpoint for the iPhone Shortcut, Wallet
  Transfer ("Move"), the owner's own numbers and accounts, pairing the two
  halves of a transfer, adaptive layout (phone, tablet, desktop).
- **Books:** one owner login. Balances were still zero and no transactions
  recorded when this was written.

## Waiting on the operator

1. **GitHub push.** Every branch is rewritten locally with real numbers
   removed (`scrub/*` branches plus `feature/ledger-rebuild`). This machine
   cannot write to the repo. Either the `gocash-deploy` deploy key gets write
   access, or the operator runs `~/homelab/gocash/push-scrubbed.sh`. Old
   commits remain reachable on GitHub through pull-request refs until GitHub
   Support purges them.
2. **The shared Shortcut.** The iCloud link received on 2026-11-21 has the
   operator's own upload key inside it and no import question, so it must not
   be given to staff or put in the app. The key should be removed in
   Settings → Share from phone and a new one made; the Shortcut needs the key
   moved into a Text action with an import question before re-sharing.
3. **Opening balances** (Settings → Wallets) and **own numbers**
   (Settings → My numbers & accounts) have to be entered by the operator.
4. **First real use** of: a transfer, a staff login, the Shortcut end to end.
   These are covered by tests but have not been exercised with real data.

## Next, in order

UX work, from `~/gocash-ux-research.md` (research of 2026-11-21):

- **Phase 1, safety and speed:** no pre-selected transaction type; Cash In /
  Cash Out / More tiles on Home; one plain name per type ("Take out profit",
  "Move my own money"); Discard asks first, Save shows "Saved · Undo"; the
  summary and Save stay above the keyboard; large amounts with thousands
  separators; a disabled Save says what is missing.
- **Phase 2, review screen:** show the receipt image; mark each field read /
  not found / please check.
- **Phase 3, legibility and themes:** minimum text size, contrast fixes,
  signs and icons alongside colour, light theme following the system with a
  manual switch (about 450 hard-coded dark colours to migrate to tokens).
- **Phase 4, home and history:** all balances visible without swiping;
  history status filter, search, day subtotals; drawer count on Home.

Then: the Android share target; GCash samples still missing (load, bills,
cash-in from bank, any real dark-mode screenshot).

## Decisions already made (do not reopen without the operator)

- Home use first; wider distribution is on hold.
- Backend reachable from the public internet, not Tailscale-only.
- Local OCR, not OpenAI.
- Platform transfer fees go to "Transfer Costs" and never reduce earnings.
- The operator's own bills are ordinary Bills Payments at the normal fee.
- Staff can record and view; only the owner voids, reconciles, changes fees,
  wallets, staff and own numbers.
- Fee: 2% with a ₱5 minimum, rounded up, for every customer type.

## Rules for working here

- Real screenshots and their answer keys live in `~/gocash-receipt-samples/`
  and never go into this repo. Invent test data. `bench-scripts/leakscan.py`
  there checks a tree or unpushed history against the answer keys.
- Nothing is pushed without the operator saying so. This repo's commits use
  the GitHub no-reply identity (set in local git config).
- The live database holds the operator's books: no test rows in it. Use the
  scratch-database test runner (`tests/run.sh` against a throwaway container).
- Keep OCR or build runs short and capped; the host overheats under long
  multi-core load.
- Check layouts with `scripts/preview/` (headless browser, mocked backend).
