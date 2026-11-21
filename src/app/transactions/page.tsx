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
  ArrowLeftRight,
} from "lucide-react";
import { typeName } from "@/lib/display";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { supabase } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { readHistory, writeHistory } from "@/lib/history-cache";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type FilterType = "All" | "Cash In" | "Cash Out" | "Telco Load" | "Bills Payment" | "Bank Transfer" | "Wallet Transfer";
const FILTERS: FilterType[] = ["All", "Cash In", "Cash Out", "Telco Load", "Bills Payment", "Bank Transfer", "Wallet Transfer"];

const TYPE_CONFIG: Record<string, { color: string; bg: string; Icon: React.ElementType }> = {
  "Cash In":           { color: "var(--foreground)", bg: "var(--muted)", Icon: ArrowDownRight },
  "Cash Out":          { color: "var(--foreground)", bg: "var(--muted)", Icon: ArrowUpLeft },
  "Telco Load":        { color: "var(--foreground)", bg: "var(--muted)", Icon: Phone },
  "Bills Payment":     { color: "var(--foreground)", bg: "var(--muted)", Icon: Zap },
  "Bank Transfer":     { color: "var(--foreground)", bg: "var(--muted)", Icon: Building2 },
  "Profit Remittance": { color: "var(--foreground)", bg: "var(--muted)", Icon: TrendingDown },
  "Wallet Transfer":   { color: "var(--foreground)", bg: "var(--muted)", Icon: ArrowLeftRight },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TxRow {
  platform: string;
  transfer_to: string | null;
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
  const [transactions, setTransactions] = useState<TxRow[]>(() => readHistory<TxRow>() ?? []);
  const [dataLoading, setDataLoading] = useState(() => readHistory<TxRow>() === null);

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId;
    async function fetchData() {
      const { data } = await supabase
        .from("transactions")
        .select("id, transaction_type, platform, transfer_to, account_number, amount, net_profit, created_at, status")
        .eq("operator_id", opId)
        .neq("status", "deleted")
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) {
        writeHistory(data);
        setTransactions(data);
      }
      setDataLoading(false);
    }
    fetchData();
  }, [operatorId]);

  if (authLoading || dataLoading) {
    return (
      <AppShell active="history" tabBar wide>
        <div className="flex-1 grid place-items-center">
          <Loader2 className="late w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      </AppShell>
    );
  }

  const filtered =
    activeFilter === "All"
      ? transactions
      : transactions.filter((t) => t.transaction_type === activeFilter);

  const groups = groupByDate(filtered);

  return (
    <AppShell active="history" tabBar wide>
      {/* Header */}
      <PageHeader title="History" />

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
              "flex-shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-all",
              activeFilter === f
                ? "bg-primary text-primary-foreground shadow-sm shadow-none"
                : "bg-muted text-muted-foreground hover:bg-foreground/10",
            ].join(" ")}
          >
            {f === "All" ? "All" : typeName(f)}
          </button>
        ))}
      </div>

      {/* Transaction Groups */}
      <div className="px-5 pb-8 space-y-5 flex-1">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <History className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <p className="text-[15px] font-medium text-muted-foreground">No transactions yet.</p>
            <Link href="/entry" className="text-[15px] text-primary mt-2 font-medium">
              Add your first one →
            </Link>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <h2 className="label mb-2.5">
                {group.label}
              </h2>
              <div className="bg-muted rounded-[20px] overflow-hidden divide-y divide-">
                {group.items.map((tx) => {
                  const cfg = TYPE_CONFIG[tx.transaction_type] ?? {
                    color: "var(--foreground)",
                    bg: "var(--muted)",
                    Icon: ArrowDownRight,
                  };
                  const Icon = cfg.Icon;
                  const isPending = tx.status === "awaiting_confirm";
                  const isVoided = tx.status === "voided";

                  return (
                    <Link
                      key={tx.id}
                      href={isPending ? `/confirm?id=${tx.id}` : `/transactions?id=${tx.id}`}
                      className="flex items-center gap-3 px-4 py-3.5 active:bg-muted"
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
                        <p className="text-[15px] font-medium truncate">
                          {typeName(tx.transaction_type)}
                        </p>
                        <p className="text-[13px] text-muted-foreground truncate">
                          {tx.transaction_type === "Wallet Transfer"
                            ? `${tx.platform} → ${tx.transfer_to ?? "?"}`
                            : maskNumber(tx.account_number)} · {formatTime(tx.created_at)}
                        </p>
                      </div>

                      {/* Amounts + badge */}
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <p className={`text-[15px] font-semibold tabular-nums ${isVoided ? "line-through text-muted-foreground" : ""}`}>
                          {isPending && !(tx.amount > 0) ? "Amount?" : "₱" + tx.amount.toLocaleString("en-PH")}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {/* A draft has earned nothing yet; its fee is worked
                              out when it is confirmed. */}
                          {!isVoided && !isPending && tx.transaction_type !== "Wallet Transfer" && (
                            <p className="text-[13px] text-primary font-medium tabular-nums">
                              +₱{tx.net_profit.toFixed(0)}
                            </p>
                          )}
                          {isVoided ? (
                            <span className="text-[13px] font-bold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                              Voided
                            </span>
                          ) : isPending ? (
                            <span className="flex items-center gap-1 text-[13px] font-bold bg-warning/20 text-warning px-1.5 py-0.5 rounded-full">
                              <span className="w-1 h-1 rounded-full bg-warning animate-pulse" />
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
    </AppShell>
  );
}

function TransactionsPageInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  if (id) {
    return (
      <TransactionDetail transactionId={id} duplicate={searchParams.get("duplicate") === "1"} />
    );
  }
  return <TransactionsList />;
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={
      <AppShell active="history" tabBar wide>
        <div className="flex-1 grid place-items-center">
          <Loader2 className="late w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      </AppShell>
    }>
      <TransactionsPageInner />
    </Suspense>
  );
}
