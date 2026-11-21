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
2. **The shared Shortcut: done 2026-11-21.** The operator re-shared it
   with the key in a Text action behind an import question
   (icloud.com/shortcuts/d6bc3ce3cff2400fb999b348dda84f9a). Checked: no key
   inside, posts the converted image to `share-upload` with
   `Bearer <Text>`. Settings → Share from phone links to it. The earlier
   link (a6fda171…) had the operator's key inside; whether that key was
   removed is for the operator to confirm.
3. **Opening balances** (Settings → Wallets) and **own numbers**
   (Settings → My numbers & accounts) have to be entered by the operator.
4. **First real use** of: a transfer, a staff login, the Shortcut end to end.
   These are covered by tests but have not been exercised with real data.

## Next, in order

UX work, from `~/gocash-ux-research.md` (research of 2026-11-21):

- **Phase 1, safety and speed: done 2026-11-21.** No pre-selected type; Cash
  In / Cash Out tiles on Home; one name per type (`src/lib/display.ts`);
  Discard asks first; "Saved · Undo" on Home after a save (owner only);
  summary and Save lifted above the keyboard (`useKeyboardInset`, not yet
  checked on a real phone); grouped amounts; a disabled Save says what is
  missing.
- **Look and feel: approved and applied 2026-11-21.** The operator chose
  design "Z1": Zether brand colours (navy #1B2E52, ink #0E1626, paper
  #F5F6F2, electric lime #D4F23A) and type (Instrument Sans for headings and
  amounts, Hanken Grotesk for body), from `~/zether-website/brand-kit`.
  Tokens live in `src/app/globals.css`; light and dark both exist, following
  the phone by default with a switch in Settings (`src/lib/theme.ts`).
  Hard-coded dark colours were migrated to tokens. Home is rebuilt (total on
  hand, wallet row, five round actions, drafts row, recent list), `/new`
  lists every transaction type, and the entry screen has wallet pills and an
  on-screen keypad (`src/components/amount-keypad.tsx`). Mockup sources are
  in `~/gocash-mockups/v6`. Lime stays under about 10% of a light screen.
- **Earnings card (2026-11-21):** the operator asked for earnings "in a
  separate wallet" and chose display only: Home shows an Earnings card =
  fees earned (revenue balance) minus confirmed "Take out profit". Drawer
  and wallet balances are unchanged and still match the real drawer and
  apps. No ledger change.
- **App feel (2026-11-21):** the shell is a fixed frame with its own scroll
  area; the tab bar is part of the layout. Sign-in and Home data are kept in
  memory between screens. Logo and icons are in `public/`
  (sources in `~/gocash-mockups/logo`).
- **Coherence pass (2026-11-21):** shared styles live in `globals.css`
  (`.btn`, `.btn-primary/-secondary/-outline/-danger`, `.btn-sm`, `.field`,
  `.label`, `.card`) and `src/components/page-header.tsx` (centred title,
  back chevron, info button that opens a sheet with the page's notes). Text
  sizes are 13 / 15 / 17. New screens must use these, not one-off classes.
- **Also added 2026-11-21:** low-balance alerts (`settings.low_balance` on
  the operator row, set under Settings → Wallets; the operator's are GCash
  2,000 and Maya 1,000), owner can edit the Earnings figure
  (`adjust-earnings` function), any wallet can be archived and brought
  back, public `/help` page, Cash Out says "Give X · collect Y fee".
- **Multiple owners (2026-11-21):** migration `20260928000001_co_owners.sql`
  (applied live). `operator_members.role` may be `owner`; `is_operator_owner`
  counts them; the founding owner (`operators.user_id`) cannot be removed or
  changed. Settings → People adds someone as staff or owner and switches
  roles (`manage-staff` action `role`). Any migration that replaces a
  function must re-GRANT execute afterwards: an event trigger revokes it.
- **Cash Out wording (operator's decision):** the app shows only
  "You earn ₱X" and a "Fee is included in the amount" checkbox. It does not
  say how much to give or collect.
- **Still in the old layout (tokens only, not redesigned):** the review
  screen (`confirm-form.tsx`), History, transaction detail, capture, login,
  onboarding and the Settings sub-pages.
- **Phase 2, review screen:** rebuild to the mockup (receipt thumbnail, plain
  rows, only the unread field marked); mark each field read / not found /
  please check.
- **Phase 4, home and history:** history status filter, search, day
  subtotals in the new style; drawer count on Home.
- Not yet checked on a real phone: the keypad, the theme switch, and
  `useKeyboardInset`.

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
