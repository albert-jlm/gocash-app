"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useState, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import TransactionDetail from "./[id]/transaction-detail";
import {
  Loader2,
  ArrowDownRight,
  ArrowUpLeft,
  Phone,
  Building2,
  History,
  Zap,
  TrendingDown,
  ChevronRight,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { supabase } from "@/lib/supabase/client";
import { isWithinDateRange, matchesTransactionSearch } from "@/lib/transaction-filters";
import { TRANSACTION_TYPES } from "@/lib/platforms";
import { AppBottomNav } from "@/components/app-bottom-nav";

const FILTERS = ["All", ...TRANSACTION_TYPES] as const;
type FilterType = (typeof FILTERS)[number];

const TYPE_CONFIG: Record<string, { color: string; bg: string; Icon: React.ElementType }> = {
  "Cash In":           { color: "#10B981", bg: "rgba(16,185,129,0.12)",  Icon: ArrowDownRight },
  "Cash Out":          { color: "#EF4444", bg: "rgba(239,68,68,0.12)",   Icon: ArrowUpLeft },
  "Telco Load":        { color: "#8B5CF6", bg: "rgba(139,92,246,0.12)",  Icon: Phone },
  "Bills Payment":     { color: "#F59E0B", bg: "rgba(245,158,11,0.12)",  Icon: Zap },
  "Bank Transfer":     { color: "#3B82F6", bg: "rgba(59,130,246,0.12)",  Icon: Building2 },
  "Profit Remittance": { color: "#6B7280", bg: "rgba(107,114,128,0.12)", Icon: TrendingDown },
};

interface TxRow {
  id: string;
  transaction_type: string;
  account_number: string | null;
  reference_number: string | null;
  amount: number;
  net_profit: number;
  created_at: string;
  status: string;
}

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

function TransactionsList() {
  const { operatorId, loading: authLoading } = useAuthGuard();
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);

  const fetchData = useCallback(async () => {
    if (!operatorId) return;
    setDataLoading(true);

    const { data } = await supabase
      .from("transactions")
      .select("id, transaction_type, account_number, reference_number, amount, net_profit, created_at, status")
      .eq("operator_id", operatorId)
      .order("created_at", { ascending: false })
      .limit(300);

    if (data) setTransactions(data);
    setDataLoading(false);
  }, [operatorId]);

  useEffect(() => {
    if (!operatorId) return;
    void fetchData();
  }, [operatorId, fetchData]);

  useEffect(() => {
    if (!operatorId) return;

    const channel = supabase
      .channel(`transactions:${operatorId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "gocash", table: "transactions", filter: `operator_id=eq.${operatorId}` },
        () => { void fetchData(); }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [operatorId, fetchData]);

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

  const searched = filtered.filter((tx) =>
    matchesTransactionSearch(tx, deferredSearch)
    && isWithinDateRange(tx.created_at, dateFrom || undefined, dateTo || undefined)
  );

  const groups = groupByDate(searched);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col bg-background text-foreground">
      <header className="px-4 pb-3 pt-12 sm:px-6 sm:pt-14 lg:px-8">
        <h1 className="text-xl font-semibold">My Transactions</h1>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          {transactions.length} total
        </p>
      </header>

      <div className="mb-4 space-y-3 px-4 sm:px-6 lg:px-8">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search amount, account, or ref number"
          className="w-full h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 text-sm outline-none focus:border-emerald-500/50"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 text-sm outline-none focus:border-emerald-500/50"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 text-sm outline-none focus:border-emerald-500/50"
          />
        </div>
      </div>

      <div
        className="mb-4 flex gap-2 overflow-x-auto px-4 sm:px-6 lg:px-8"
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

      <div className="flex-1 space-y-5 px-4 pb-32 sm:px-6 lg:px-8">
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

                  return (
                    <Link
                      key={tx.id}
                      href={`/transactions?id=${tx.id}`}
                      className="flex items-center gap-3 px-4 py-3.5 active:bg-white/[0.03]"
                    >
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: cfg.bg }}
                      >
                        <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{tx.transaction_type}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {maskNumber(tx.account_number)} · {formatTime(tx.created_at)}
                        </p>
                        {tx.reference_number && (
                          <p className="text-[10px] text-muted-foreground/60 truncate">
                            Ref {tx.reference_number}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <p className="text-sm font-semibold tabular-nums">
                          ₱{tx.amount.toLocaleString("en-PH")}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <p className="text-[11px] text-emerald-400 font-medium tabular-nums">
                            +₱{tx.net_profit.toFixed(0)}
                          </p>
                          <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
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

      <AppBottomNav />
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
