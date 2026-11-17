# GoCash Blueprint

> Why this project exists, who it is for, and what it must do.
> This is the starting point for anyone new to the repo. `PRD.md` covers the
> requirements in detail and `TECH_SPEC.md` covers the build; where they
> disagree with this file about purpose, this file wins.

Last updated: 2026-11-18

---

## 1. The market problem

Cash-in/cash-out shops in the Philippines move money for customers through
GCash, Maya, MariBank and bank transfers all day. **None of these platforms
gives a small agent an integration they can hook into to pull their
transactions into one set of books.** Each platform shows its own history
inside its own app, and nothing more: not the other wallets, not the cash in
the drawer, not the fee the agent charged on top.

So the record-keeping that ties it all together has to happen on the agent's
side, by hand. Today that means writing each transaction in a notebook or
typing it into Excel.

Manual logging is slow, easy to skip when the shop is busy, and easy to get
wrong. When it slips, the operator no longer knows:

- how much e-money is left in each wallet,
- how much cash should be in the drawer,
- how much they actually earned today.

A few small apps have started to appear for this job (see section 7), but none
has real adoption and none covers the whole picture. That is the gap GoCash is
built to fill.

## 2. Who it is for

People running cash-in/cash-out businesses in the Philippines: sari-sari
stores, remittance counters and standalone e-wallet agents. They are running a
small business on a phone, usually between customers. They are not technical
and should not need to be.

The first operator is the author's own shop. It has no special status in the
system; anything it needs must work the same way for the next operator.

## 3. The solution

Since the data cannot be pulled from the platforms, GoCash makes capturing it
from the agent's side as close to effortless as possible. There are two ways
to record a transaction:

1. **Share a screenshot.** Every transaction already produces a receipt screen
   in the e-wallet app. The operator screenshots it and shares it to GoCash.
   The app reads the receipt (platform, type, amount, reference number, date),
   works out the fee, and shows a draft. This is the easy path and the main
   reason the product exists.
2. **Type it in.** A short form for transactions with no receipt, or when the
   operator prefers to enter it directly.

Either way, the operator reviews and confirms before anything is counted. Once
confirmed, the app keeps the books:

- the balance of each e-wallet (GCash, Maya, MariBank, others the operator adds),
- the cash that should be in the drawer,
- the operator's earnings from fees,
- a searchable history of every transaction.

The operator can count the drawer at any time and check it against what the
app expects.

## 4. Principles

These follow from the problem and should settle most design arguments.

- **No integration required.** The product must work with nothing but what the
  operator already has: the receipt on their screen and their own input.
- **Faster than the notebook.** If recording a transaction takes longer than
  writing it down, operators will go back to writing it down.
- **The operator confirms, the app never guesses silently.** The AI reads the
  receipt, but a person approves it before balances move. When the app cannot
  read something, it asks; it does not fill in a default.
- **The books must always balance.** Every transaction is recorded as a
  double-entry ledger entry. Money cannot appear or vanish because of a bug,
  and mistakes are corrected by reversing, never by erasing history.
- **Built for many operators.** Nothing is hardcoded to one shop. Fees,
  wallets and phone numbers are per-operator settings.
- **Customer data is handled with care.** Receipts contain customers' mobile
  numbers. They are kept only as long as needed (PH Data Privacy Act).
- **A screenshot is a record, not proof.** Fake and AI-generated receipts are a
  known scam. The app reads what the operator shares; it cannot verify that
  money arrived and must never suggest that it does.

## 5. What it covers

Transaction types: Cash In, Cash Out, Telco Load, Bills Payment, Bank Transfer
and Profit Remittance (the owner taking earnings out).

Fees are set per operator. The first operator charges 2% with a ₱5 minimum,
rounded up.

## 6. What it is not

- Not a payment app. GoCash never moves money; it records what the operator
  already did in GCash, Maya or the bank.
- Not connected to the e-wallet platforms. It reads receipts, nothing more.
- Not an accounting package. It tracks wallets, drawer cash and fee earnings
  for one kind of business.

## 7. Competitors and substitutes

From a web check on 2026-11-18. Install counts are from Google Play listings
on that date; none of this has been tested hands-on.

| Product | What it does | What it lacks |
|---|---|---|
| MyTinda PayWallet | Scans GCash receipts, computes the agent's own fee, owner and cashier phones, reports. 5+ installs, new this month | GCash only; no wallet or drawer balances mentioned |
| Cash In Cash Out Logbook | Logs all service types, GCash receipt input, duplicate detection. 500+ installs | No balances, drawer cash or fee engine stated |
| KaSari | Sari-sari POS with a GCash/Maya/load module, wallet balances, end-of-day cash count. 100+ installs | No receipt scanning mentioned; bundled into a full POS |
| GCash Pera Outlet Plus (official) | Wallet history, earnings monitor, saved customers. 100K+ installs | Its own wallet only; requires onboarding as an outlet |
| Maya Business (official) | Agent services with simple onboarding. 1M+ installs | Its own wallet only |
| Excel/Sheets templates, printed logbooks | Manual log with running balance. About ₱100-180 for paid templates | Everything is typed or written by hand |

**Where GoCash is different:** several wallets and the physical cash drawer
reconciled in one place; receipt reading that is not limited to GCash; and the
agent's own fee tracked separately from any platform commission.

**What the check warns about:**

- Apps aimed at exactly this job, with receipt scanning, have almost no
  installs. The missing piece may be demand or distribution, not the product.
- An agent who is formally onboarded and uses a single wallet already gets
  history and earnings from the official app.
- Many target users run the business on a personal e-wallet account, which the
  platforms do not support for business use. That is a risk for them and
  therefore for the product.

## 8. Business model

> **Current focus (decided 2026-11-18): home use first.** The app is being
> finished and deployed for the author's own shop only. Wider distribution to
> other stores, and everything that exists only to support it (signup, billing,
> onboarding other operators), is on hold until the app has proven itself in
> daily use at home. The model below is the later intent, not current work.

Multi-tenant SaaS: one app, many operators, each seeing only their own books.
Billing and self-serve signup are deferred until an operator asks to pay.

## 9. Where things stand

The app is mid-rebuild on `feature/ledger-rebuild`, replacing the original
balance model with the double-entry ledger and restoring the confirm-before-
counting step. See `project-status.md` for progress and `AUDITS.md` for
findings.

## 10. Open questions

Not yet answered anywhere in the repo:

- **Demand.** Similar apps exist and have barely been installed. Do agents want
  this enough to change how they work, and what would prove it? No first-hand
  accounts from agents (other than the first operator) have been gathered.
- **Price.** What an operator would pay per month, and what they would compare
  it to.
- **Reach.** How operators beyond the first one will hear about it and get
  set up.
- **Receipt accuracy.** How often the AI reads a receipt correctly across
  different operators' phones and platforms. Only one operator's receipts
  have been tested so far.
- **Multiple staff.** Whether a shop needs several people recording into the
  same books.
