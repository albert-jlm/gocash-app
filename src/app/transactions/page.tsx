"use client";

import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TransactionDetail from "./[id]/transaction-detail";
import {
  Loader2,
  ArrowDownRight,
  ArrowUpLeft,
  Phone,
  Building2,
  Home,
  Plus,
  History,
  Settings,
  Zap,
  TrendingDown,
  ChevronRight,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { supabase } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type FilterType = "All" | "Cash In" | "Cash Out" | "Telco Load" | "Bills Payment" | "Bank Transfer";
const FILTERS: FilterType[] = ["All", "Cash In", "Cash Out", "Telco Load", "Bills Payment", "Bank Transfer"];

const TYPE_CONFIG: Record<string, { color: string; bg: string; Icon: React.ElementType }> = {
  "Cash In":           { color: "#10B981", bg: "rgba(16,185,129,0.12)",  Icon: ArrowDownRight },
  "Cash Out":          { color: "#EF4444", bg: "rgba(239,68,68,0.12)",   Icon: ArrowUpLeft },
  "Telco Load":        { color: "#8B5CF6", bg: "rgba(139,92,246,0.12)",  Icon: Phone },
  "Bills Payment":     { color: "#F59E0B", bg: "rgba(245,158,11,0.12)",  Icon: Zap },
  "Bank Transfer":     { color: "#3B82F6", bg: "rgba(59,130,246,0.12)",  Icon: Building2 },
  "Profit Remittance": { color: "#6B7280", bg: "rgba(107,114,128,0.12)", Icon: TrendingDown },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TxRow {
  id: string;
  transaction_type: string;
  account_number: string | null;
  amount: number;
  net_profit: number;
  created_at: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskNumber(num: string | null): string {
  if (!num) return "—";
  const d = num.replace(/\D/g, "");
  return d.length >= 8 ? d.slice(0, 4) + "•••" + d.slice(-4) : num;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-PH", { month: "long", day: "numeric" });
}

function toDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function groupByDate(rows: TxRow[]): Array<{ label: string; key: string; items: TxRow[] }> {
  const map = new Map<string, { label: string; items: TxRow[] }>();
  for (const tx of rows) {
    const key = toDateKey(tx.created_at);
    if (!map.has(key)) map.set(key, { label: dateLabel(tx.created_at), items: [] });
    map.get(key)!.items.push(tx);
  }
  return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function TransactionsList() {
  const { operatorId, loading: authLoading } = useAuthGuard();
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId;
    async function fetchData() {
      setDataLoading(true);
      const { data } = await supabase
        .from("transactions")
        .select("id, transaction_type, account_number, amount, net_profit, created_at, status")
        .eq("operator_id", opId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) setTransactions(data);
      setDataLoading(false);
    }
    fetchData();
  }, [operatorId]);

  if (authLoading || dataLoading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  const filtered =
    activeFilter === "All"
      ? transactions
      : transactions.filter((t) => t.transaction_type === activeFilter);

  const groups = groupByDate(filtered);

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground max-w-[390px] mx-auto">
      {/* Header */}
      <header className="px-5 pt-14 pb-3">
        <h1 className="text-xl font-semibold">My Transactions</h1>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          {transactions.length} total · {transactions.filter(t => t.status === "awaiting_confirm").length} to review
        </p>
      </header>

      {/* Filter Chips — horizontal scroll, pill style */}
      <div
        className="flex gap-2 px-5 mb-4 overflow-x-auto"
        style={{ scrollbarWidth: "none", paddingBottom: 2 }}
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={[
              "flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all",
              activeFilter === f
                ? "bg-emerald-500 text-white shadow-sm shadow-emerald-900/40"
                : "bg-white/[0.07] text-muted-foreground hover:bg-white/[0.11]",
            ].join(" ")}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Transaction Groups */}
      <div className="px-5 pb-32 space-y-5 flex-1">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.05] flex items-center justify-center mb-4">
              <History className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">No transactions yet.</p>
            <Link href="/capture" className="text-sm text-emerald-400 mt-2 font-medium">
              Add your first one →
            </Link>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5">
                {group.label}
              </h2>
              <div className="bg-white/[0.04] rounded-2xl overflow-hidden divide-y divide-white/[0.05] border border-white/[0.05]">
                {group.items.map((tx) => {
                  const cfg = TYPE_CONFIG[tx.transaction_type] ?? {
                    color: "#6B7280",
                    bg: "rgba(107,114,128,0.12)",
                    Icon: ArrowDownRight,
                  };
                  const Icon = cfg.Icon;
                  const isPending = tx.status === "awaiting_confirm";

                  return (
                    <Link
                      key={tx.id}
                      href={isPending ? `/confirm?id=${tx.id}` : `/transactions?id=${tx.id}`}
                      className="flex items-center gap-3 px-4 py-3.5 active:bg-white/[0.03]"
                    >
                      {/* Icon */}
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: cfg.bg }}
                      >
                        <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{tx.transaction_type}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {maskNumber(tx.account_number)} · {formatTime(tx.created_at)}
                        </p>
                      </div>

                      {/* Amounts + badge */}
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <p className="text-sm font-semibold tabular-nums">
                          ₱{tx.amount.toLocaleString("en-PH")}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <p className="text-[11px] text-emerald-400 font-medium tabular-nums">
                            +₱{tx.net_profit.toFixed(0)}
                          </p>
                          {isPending ? (
                            <span className="flex items-center gap-1 text-[9px] font-bold bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full">
                              <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                              Review
                            </span>
                          ) : (
                            <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] px-5 pb-8 pt-4 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none">
        <nav className="flex items-center justify-around pointer-events-auto">
          <Link href="/" className="flex flex-col items-center gap-1 min-w-[48px]">
            <Home className="w-5 h-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Home</span>
          </Link>
          <Link href="/capture" className="flex flex-col items-center gap-1 min-w-[48px]">
            <Plus className="w-5 h-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">New</span>
          </Link>
          <Link href="/transactions" className="flex flex-col items-center gap-1 min-w-[48px]">
            <History className="w-5 h-5 text-foreground" />
            <span className="text-[10px] text-foreground font-medium">History</span>
          </Link>
          <Link href="/settings" className="flex flex-col items-center gap-1 min-w-[48px]">
            <Settings className="w-5 h-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Settings</span>
          </Link>
        </nav>
      </div>
    </div>
  );
}

function TransactionsPageInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  if (id) return <TransactionDetail transactionId={id} />;
  return <TransactionsList />;
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    }>
      <TransactionsPageInner />
    </Suspense>
  );
}
