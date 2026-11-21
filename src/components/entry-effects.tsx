"use client";

/**
 * "What this changes", in the operator's terms.
 *
 * The ledger stores every leg as a signed number where earnings are a credit,
 * so a fee earned is NEGATIVE in the books. Showing those raw signs put
 * "Your earnings −₱21.00" in red on the review screen: correct bookkeeping,
 * and exactly the wrong message. Here each line says what happens to something
 * the operator can point at:
 *
 *   a wallet or the drawer   goes up (green +) or down (red −)
 *   earnings                 "You earn ₱21.00", always shown as a gain
 *   a platform's fee         "App's fee ₱15.00", a cost, not a loss of earnings
 *   money taken out          "You take out ₱5,000.00"
 */

import type { Posting } from "@core/types.ts";
import { formatPesos } from "@/lib/ledger";

interface Line { label: string; value: string; tone: "up" | "down" | "earn" | "plain" | "note" }

function describeCashOut(postings: readonly Posting[], feeInside: boolean): Line[] | null {
  const wallet = postings.find((p) => p.account.kind === "platform");
  const cash = postings.find((p) => p.account.kind === "cash");
  const fee = postings.find((p) => p.account.kind === "revenue");
  if (postings.length !== 3 || !wallet || !cash || !fee) return null;
  if (!(wallet.amount > 0 && cash.amount < 0 && fee.amount < 0)) return null;
  if (wallet.account.kind !== "platform") return null;

  const received = formatPesos(wallet.amount / 100);
  const cashOnly = formatPesos(-cash.amount / 100);
  const earned = formatPesos(-fee.amount / 100);
  const first: Line = { label: `${wallet.account.platform} wallet`, value: `+${received}`, tone: "up" };

  if (feeInside) {
    return [
      first,
      { label: "Give the customer", value: cashOnly, tone: "plain" },
      { label: "Your fee, already in what they sent", value: earned, tone: "earn" },
    ];
  }
  return [
    first,
    { label: "Give the customer", value: received, tone: "plain" },
    { label: "Collect your fee in cash", value: earned, tone: "earn" },
    { label: `Or give ${cashOnly} and keep the fee. Either way the drawer ends ${cashOnly} lower.`, value: "", tone: "note" },
  ];
}

export function describeEffects(postings: readonly Posting[], opts: { feeInside?: boolean } = {}): Line[] {
  const cashOut = describeCashOut(postings, opts.feeInside === true);
  if (cashOut) return cashOut;

  const money: Line[] = [];
  const outcome: Line[] = [];

  for (const p of postings) {
    const pesos = p.amount / 100;
    const abs = formatPesos(Math.abs(pesos));

    if (p.account.kind === "platform" || p.account.kind === "cash") {
      const label = p.account.kind === "platform" ? `${p.account.platform} wallet` : "Cash drawer";
      money.push({ label, value: `${pesos > 0 ? "+" : "−"}${abs}`, tone: pesos > 0 ? "up" : "down" });
    } else if (p.account.kind === "revenue") {
      // A credit to revenue (negative here) is money earned.
      outcome.push(pesos < 0
        ? { label: "You earn", value: abs, tone: "earn" }
        : { label: "Earnings given back", value: `−${abs}`, tone: "down" });
    } else if (p.account.kind === "expense") {
      outcome.push({ label: "App's fee (a cost, not from your earnings)", value: abs, tone: "plain" });
    } else if (p.account.kind === "equity") {
      outcome.push(pesos > 0
        ? { label: "You take out", value: abs, tone: "plain" }
        : { label: "You put in", value: abs, tone: "plain" });
    }
  }
  return [...money, ...outcome];
}

const TONE: Record<Line["tone"], string> = {
  up: "text-primary",
  down: "text-destructive",
  earn: "text-primary",
  plain: "text-foreground",
  note: "text-muted-foreground",
};

export function EntryEffects({
  postings,
  dense = false,
  feeInside = false,
}: {
  postings: readonly Posting[];
  dense?: boolean;
  feeInside?: boolean;
}) {
  const lines = describeEffects(postings, { feeInside });
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) =>
        line.tone === "note" ? (
          <p key={i} className="text-[13px] text-muted-foreground leading-relaxed pt-1">{line.label}</p>
        ) : (
          <div key={i} className={`flex items-baseline justify-between gap-3 ${dense ? "text-[13px]" : "text-sm"}`}>
            <span className="text-muted-foreground">{line.label}</span>
            <span className={`tabular-nums font-medium flex-shrink-0 ${TONE[line.tone]}`}>{line.value}</span>
          </div>
        ),
      )}
    </div>
  );
}
