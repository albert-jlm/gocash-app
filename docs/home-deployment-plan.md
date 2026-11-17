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

- [ ] Void from the transaction screen; remove the "Edit" button that always
      fails.
- [ ] Show the result after a drawer reconcile.
- [ ] Duplicate screenshot: show the existing transaction, not a dead end.
- [ ] Logout button.
- [ ] Pending-drafts list on the home screen.

## Step 3 — Sharing a screenshot from the phone (both platforms)

- [ ] **Android:** register the installed web app as a share target (manifest
      entry plus code to receive the shared image), landing on the confirm
      screen.
- [ ] **iPhone:** a per-device upload key that can only create drafts, and an
      Apple Shortcut ("Send to GoCash") that appears in the share sheet,
      uploads the image and shows a notification. The draft is confirmed from
      the pending list in the app.
- [ ] Written setup steps for each phone.

## Step 4 — Deploy at home

Access (decided 2026-11-18): the app and its backend stay reachable from the
public internet, not Tailscale-only, so the phones work anywhere.

- [ ] Add the missing schema and table grants to the migrations.
- [ ] Start the dedicated stack in `~/homelab/gocash/` (secrets, `.env`).
- [ ] Load the schema, provision the operator, set opening balances.
- [ ] Point the site at the new stack.
- [ ] Confirm the backup covers the new database.

## Not now

- Merging the 35 commits on `main` (Google sign-in, filters, toasts).
- Native iOS/Android builds.
- Moving the operator's phone numbers into a per-operator table.
- Receipt retention rules.
- Signup, billing, anything multi-operator.
