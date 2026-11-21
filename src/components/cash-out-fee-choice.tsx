"use client";

import { Check } from "lucide-react";

export function CashOutFeeChoice({
  value,
  onChange,
}: {
  amountPesos?: number;
  platform?: string;
  rules?: unknown;
  value: boolean;
  onChange: (includesFee: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="mx-auto flex items-center gap-2.5 h-11 px-1 text-[15px] font-medium"
    >
      <span
        className={`w-6 h-6 rounded-md grid place-items-center border-2 transition-colors ${
          value ? "bg-primary border-primary text-primary-foreground" : "border-input"
        }`}
      >
        {value && <Check className="w-4 h-4" strokeWidth={3} />}
      </span>
      Fee is included in the amount
    </button>
  );
}
