"use client";

import Link from "next/link";
import {
  ArrowDown, ArrowUp, ArrowLeftRight, Building2, ChevronLeft, ChevronRight,
  Loader2, ReceiptText, ScanLine, Smartphone, Wallet,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { AppShell } from "@/components/app-shell";
import { typeName } from "@/lib/display";

const ROWS: { type: string; note: string; Icon: React.ElementType; ownerOnly?: boolean }[] = [
  { type: "Cash In",           note: "Customer gives cash",      Icon: ArrowDown },
  { type: "Cash Out",          note: "Customer takes cash",      Icon: ArrowUp },
  { type: "Telco Load",        note: "Customer buys load",       Icon: Smartphone },
  { type: "Bills Payment",     note: "You pay a customer's bill", Icon: ReceiptText },
  { type: "Bank Transfer",     note: "Send to a bank account",   Icon: Building2 },
  { type: "Wallet Transfer",   note: "Between my wallets",       Icon: ArrowLeftRight },
  { type: "Profit Remittance", note: "Earnings out of the drawer", Icon: Wallet },
];

export default function NewTransactionPage() {
  const { loading } = useAuthGuard();

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <AppShell active="new">
      <header className="px-6 pt-[calc(env(safe-area-inset-top)+1.25rem)] lg:pt-10 pb-4 grid grid-cols-[44px_1fr_44px] items-center">
        <Link href="/" aria-label="Back" className="w-11 h-11 -ml-2.5 grid place-items-center">
          <ChevronLeft className="w-[22px] h-[22px]" />
        </Link>
        <h1 className="text-[17px] font-semibold text-center">New transaction</h1>
      </header>

      <section className="px-6 pb-10">
        {ROWS.map(({ type, note, Icon }) => (
          <Link
            key={type}
            href={`/entry?type=${encodeURIComponent(type)}`}
            className="flex items-center gap-3.5 py-3 border-b border-border"
          >
            <span className="w-[42px] h-[42px] rounded-full bg-action text-action-foreground grid place-items-center flex-shrink-0">
              <Icon className="w-5 h-5" strokeWidth={1.9} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-medium">{typeName(type)}</span>
              <span className="block text-[13px] text-muted-foreground">{note}</span>
            </span>
            <ChevronRight className="w-[18px] h-[18px] text-muted-foreground" />
          </Link>
        ))}
        <Link href="/capture" className="flex items-center gap-3.5 py-3">
          <span className="w-[42px] h-[42px] rounded-full bg-muted grid place-items-center flex-shrink-0">
            <ScanLine className="w-5 h-5" strokeWidth={1.9} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium">Scan a receipt</span>
            <span className="block text-[13px] text-muted-foreground">Read it from a screenshot</span>
          </span>
          <ChevronRight className="w-[18px] h-[18px] text-muted-foreground" />
        </Link>
      </section>
    </AppShell>
  );
}
