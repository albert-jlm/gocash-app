"use client";

/**
 * Cash Out: was the fee already inside the amount on the receipt?
 *
 * A customer who wants ₱1,000 in cash often sends ₱1,020: the cash plus the
 * fee. Charging 2% on the whole ₱1,020 gives ₱21 and ₱999 to hand over;
 * charging it on the ₱1,000 gives ₱20 and ₱1,000. The number alone cannot say
 * which happened, so the operator is asked.
 *
 * But only when the answer matters. For most amounts the two readings round
 * to the same fee, and a tick-box that changes nothing teaches people to
 * ignore it. So this renders nothing unless the two answers differ, and then
 * it shows both outcomes side by side instead of a tick.
 */

import { useEffect, useMemo } from "react";
import { Check } from "lucide-react";
import type { FeeRule, Posting } from "@core/types.ts";
import { formatPesos, previewEntry } from "@/lib/ledger";

function handedOver(postings: readonly Posting[]): number {
  const cash = postings.find((p) => p.account.kind === "cash");
  return cash ? -cash.amount / 100 : 0;
}

export function CashOutFeeChoice({
  amountPesos, platform, rules, value, onChange,
}: {
  amountPesos: number;
  platform: string;
  rules: readonly FeeRule[];
  value: boolean;
  onChange: (includesFee: boolean) => void;
}) {
  const options = useMemo(() => {
    if (!(amountPesos > 0) || !platform) return null;
    try {
      const quote = (amountIncludesFee: boolean) =>
        previewEntry({ transactionType: "Cash Out", platform, amountPesos, amountIncludesFee }, rules);
      const onWhole = quote(false);
      const inside = quote(true);
      if (onWhole.feeMinor === inside.feeMinor) return null;
      return { onWhole, inside };
    } catch {
      return null;
    }
  }, [amountPesos, platform, rules]);

  // When the answer no longer matters, a stale "yes" must not linger.
  useEffect(() => {
    if (!options && value) onChange(false);
  }, [options, value, onChange]);

  if (!options) return null;

  const rows = [
    {
      includes: true,
      title: "Yes",
      detail: `Give ${formatPesos(handedOver(options.inside.postings))}`,
    },
    {
      includes: false,
      title: "No, it is on top",
      detail: `Give ${formatPesos(amountPesos)}, collect ${formatPesos(options.onWhole.feePesos)}`,
    },
  ];

  return (
    <div className="space-y-2 pt-1" role="radiogroup" aria-label="Is your fee already inside the amount they sent?">
      <p className="text-[13px] text-muted-foreground">Is your fee inside the amount sent?</p>
      {rows.map((row) => {
        const selected = value === row.includes;
        return (
          <button
            key={String(row.includes)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(row.includes)}
            className={`w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
              selected ? "border-primary/50 bg-primary/[0.08]" : "border-border bg-muted"
            }`}
          >
            <span
              className={`w-4 h-4 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center ${
                selected ? "bg-primary" : "bg-foreground/10"
              }`}
            >
              {selected && <Check className="w-3 h-3 text-primary-foreground" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{row.title}</span>
              <span className="block text-[13px] text-muted-foreground">{row.detail}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
