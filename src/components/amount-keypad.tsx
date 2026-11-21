"use client";

import { Delete } from "lucide-react";
import { formatAmountInput } from "@/lib/display";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"] as const;

export function AmountKeypad({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const press = (key: string) => {
    const raw = value.replace(/,/g, "");
    if (raw === "" && key === "00") return;
    if (raw.replace(/\D/g, "").length + key.length > 9) return;
    onChange(formatAmountInput(raw + key));
  };
  const erase = () => onChange(formatAmountInput(value.replace(/,/g, "").slice(0, -1)));

  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => press(key)}
          className="amount h-[54px] rounded-2xl bg-muted text-2xl font-semibold active:bg-input touch-manipulation select-none"
        >
          {key}
        </button>
      ))}
      <button
        type="button"
        onClick={erase}
        aria-label="Delete last digit"
        className="h-[54px] rounded-2xl grid place-items-center text-muted-foreground active:bg-muted touch-manipulation"
      >
        <Delete className="w-[26px] h-[26px]" strokeWidth={1.9} />
      </button>
    </div>
  );
}
