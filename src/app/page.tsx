"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Loader2, Settings, ArrowDownRight, ArrowUpLeft, Phone,
  Building2, Home, Plus, History, ChevronRight, Zap, TrendingDown,
  CreditCard, Camera, Keyboard, AlertCircle,
  ArrowLeftRight,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useShareIntent } from "@/hooks/useShareIntent";
import { supabase } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Tailwind gradient classes + glow colour for each wallet
const WALLET_STYLES: Record<string, { gradient: string; glow: string }> = {
  GCash:    { gradient: "from-blue-500 via-blue-600 to-blue-700",     glow: "rgba(59,130,246,0.30)" },
  MariBank: { gradient: "from-purple-500 via-purple-600 to-purple-700", glow: "rgba(139,92,246,0.30)" },
  Maya:     { gradient: "from-green-500 via-green-600 to-green-700",   glow: "rgba(34,197,94,0.30)" },
  Cash:     { gradient: "from-emerald-500 via-emerald-600 to-emerald-700", glow: "rgba(16,185,129,0.30)" },
};
const DEFAULT_WALLET_STYLE = { gradient: "from-zinc-600 via-zinc-700 to-zinc-800", glow: "transparent" };

const TYPE_CONFIG: Record<string, { color: string; Icon: React.ElementType }> = {
  "Cash In":           { color: "#10B981", Icon: ArrowDownRight },
  "Cash Out":          { color: "#EF4444", Icon: ArrowUpLeft },
  "Telco Load":        { color: "#8B5CF6", Icon: Phone },
  "Bills Payment":     { color: "#F59E0B", Icon: Zap },
  "Bank Transfer":     { color: "#3B82F6", Icon: Building2 },
  "Profit Remittance": { color: "#6B7280", Icon: TrendingDown },
  "Wallet Transfer":   { color: "#06B6D4", Icon: ArrowLeftRight },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// A row of gocash.account_balances. Balances are derived from the ledger, never
// stored — `gocash.wallets` and its in-place `balance` column are gone.
interface AccountBalance {
  account_id: string;
  name: string;
  kind: string;
  /**
   * The sign-corrected balance, which is what a human should read. Only
   * `platform` and `cash` accounts reach these cards, but using
   * `natural_balance` everywhere keeps one rule for the whole app.
   */
  natural_balance: number;
}

/** A draft waiting for the operator: read from a screenshot or typed, not yet counted. */
interface PendingRow {
  id: string;
  transaction_type: string;
  platform: string;
  amount: number;
  created_at: string;
}

interface TxRow {
  id: string;
  transaction_type: string;
  platform: string;
  transfer_to: string | null;
  account_number: string | null;
  amount: number;
  net_profit: number;
  created_at: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBalance(n: number): string {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAmount(n: number): string {
  if (n >= 1000) return "₱" + (n / 1000).toFixed(1) + "k";
  return "₱" + n.toLocaleString("en-PH");
}

function maskNumber(num: string | null): string {
  if (!num) return "—";
  const d = num.replace(/\D/g, "");
  return d.length >= 8 ? d.slice(0, 4) + "•••" + d.slice(-4) : num;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { operatorId, loading: authLoading } = useAuthGuard();
  useShareIntent();

  const [wallets, setWallets] = useState<AccountBalance[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [todayStats, setTodayStats] = useState({ count: 0, total: 0, earnings: 0 });
  const [recentTx, setRecentTx] = useState<TxRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Wallet scroll snap — progress dot tracking
  const walletScrollRef = useRef<HTMLDivElement>(null);
  const [activeWallet, setActiveWallet] = useState(0);

  // Mouse drag-to-scroll for wallet cards (desktop UX from 21st.dev component)
  const dragState = useRef({ isDragging: false, startX: 0, scrollLeft: 0 });
  useEffect(() => {
    const el = walletScrollRef.current;
    if (!el) return;
    const onDown = (e: MouseEvent) => {
      dragState.current = { isDragging: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
      el.style.cursor = "grabbing";
    };
    const onMove = (e: MouseEvent) => {
      if (!dragState.current.isDragging) return;
      e.preventDefault();
      el.scrollLeft = dragState.current.scrollLeft - (e.pageX - el.offsetLeft - dragState.current.startX) * 1.5;
    };
    const onUp = () => { dragState.current.isDragging = false; el.style.cursor = "grab"; };
    el.addEventListener("mousedown", onDown);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseup", onUp);
    el.addEventListener("mouseleave", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseup", onUp);
      el.removeEventListener("mouseleave", onUp);
    };
  }, []);

  const handleWalletScroll = useCallback(() => {
    const el = walletScrollRef.current;
    if (!el) return;
    // Card width (280) + gap (12) = 292
    setActiveWallet(Math.round(el.scrollLeft / 292));
  }, []);

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId; // narrow to string for async closure

    async function fetchData() {
      setDataLoading(true);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      setLoadError(false);

      const [walletsRes, pendingRes, todayTxRes, recentRes] = await Promise.all([
        supabase
          .from("account_balances")
          .select("account_id, name, kind, natural_balance")
          .eq("operator_id", opId)
          // Wallet cards are the accounts the operator actually holds money in.
          // `revenue` (fees earned) and `equity` (the owner's stake) are
          // bookkeeping accounts that exist so entries balance; showing them as
          // wallets would read as money the operator can spend.
          .in("kind", ["platform", "cash"])
          .order("kind")
          .order("name"),
        supabase
          .from("transactions")
          .select("id, transaction_type, platform, amount, created_at", { count: "exact" })
          .eq("operator_id", opId)
          .eq("status", "awaiting_confirm")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("transactions")
          .select("amount, net_profit")
          .eq("operator_id", opId)
          .eq("status", "confirmed")
          // Moving the shop's own float is not a sale: it would inflate the
          // day's count and total while earning nothing.
          .neq("transaction_type", "Wallet Transfer")
          .gte("created_at", todayStart.toISOString()),
        supabase
          .from("transactions")
          .select("id, transaction_type, platform, transfer_to, account_number, amount, net_profit, created_at, status")
          .eq("operator_id", opId)
          // Drafts have their own list above; this one is what has been saved.
          .in("status", ["confirmed", "voided"])
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      // A failed query used to be ignored, so being offline looked like an
      // account with no wallets and no transactions.
      if (walletsRes.error || pendingRes.error || todayTxRes.error || recentRes.error) {
        setLoadError(true);
      }

      if (walletsRes.data) setWallets(walletsRes.data);
      setPendingCount(pendingRes.count ?? pendingRes.data?.length ?? 0);
      if (pendingRes.data) setPending(pendingRes.data);

      if (todayTxRes.data) {
        setTodayStats({
          count: todayTxRes.data.length,
          total: todayTxRes.data.reduce((s, t) => s + t.amount, 0),
          earnings: todayTxRes.data.reduce((s, t) => s + t.net_profit, 0),
        });
      }

      if (recentRes.data) setRecentTx(recentRes.data);
      setDataLoading(false);
    }

    fetchData();
  }, [operatorId, reloadTick]);

  if (authLoading || dataLoading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <AppShell active="home" tabBar wide>
      {/* Header */}
      <header className="px-5 pt-14 lg:pt-10 pb-5 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium tracking-widest uppercase text-muted-foreground">
            Good {getTimeOfDay()}
          </p>
          <h1 className="text-xl font-semibold mt-0.5">GoCash Tracker</h1>
        </div>
        <Link
          href="/settings"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center lg:hidden"
        >
          <Settings className="w-4 h-4 text-muted-foreground" />
        </Link>
      </header>

      {/* Wallet Cards — horizontal snap scroll (21st.dev design) */}
      <section className="mb-4">
        <div
          ref={walletScrollRef}
          onScroll={handleWalletScroll}
          className="flex gap-3 px-5 scroll-pl-5 overflow-x-auto pb-2 cursor-grab lg:grid lg:grid-cols-2 xl:grid-cols-4 lg:overflow-visible lg:cursor-default"
          style={{ scrollbarWidth: "none", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >
          {wallets.map((w) => {
            const style = WALLET_STYLES[w.name] ?? DEFAULT_WALLET_STYLE;
            return (
              <div key={w.account_id} className="flex-shrink-0 w-[280px] lg:w-auto" style={{ scrollSnapAlign: "start" }}>
                <div
                  className={`relative h-[160px] rounded-3xl bg-gradient-to-br ${style.gradient} p-6 flex flex-col justify-between overflow-hidden`}
                  style={{ boxShadow: `0 12px 40px -12px ${style.glow}` }}
                >
                  {/* Decorative blur blobs — from 21st.dev component */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -translate-y-8 translate-x-8 pointer-events-none" />
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full blur-xl translate-y-8 -translate-x-8 pointer-events-none" />

                  {/* Top row: icon badge + name */}
                  <div className="relative z-10 flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center flex-shrink-0">
                      <CreditCard className="w-4 h-4 text-white" />
                    </div>
                    <p className="text-white/80 text-sm font-medium">{w.name}</p>
                  </div>

                  {/* Balance */}
                  <div className="relative z-10">
                    <p className="text-[11px] text-white/50 font-medium mb-0.5 uppercase tracking-widest">Balance</p>
                    <p className="text-white text-[28px] font-bold tracking-tight tabular-nums leading-none">
                      {formatBalance(w.natural_balance)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress dots */}
        {wallets.length > 1 && (
          <div className="flex justify-center gap-1.5 mt-3 lg:hidden">
            {wallets.map((_, i) => (
              <div
                key={i}
                className="rounded-full transition-all duration-300"
                style={{
                  width: i === activeWallet ? 16 : 6,
                  height: 6,
                  backgroundColor: i === activeWallet ? "rgb(52,211,153)" : "rgba(255,255,255,0.2)",
                }}
              />
            ))}
          </div>
        )}
      </section>

      {loadError && (
        <section className="px-5 mb-4">
          <button
            type="button"
            onClick={() => setReloadTick((n) => n + 1)}
            className="w-full flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3 text-left"
          >
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-300 flex-1">
              Couldn&apos;t load everything. What you see may be out of date. Tap to try again.
            </p>
          </button>
        </section>
      )}

      {/* On a phone these four sections are one column, in the order given
          by `order-*`. On a desktop the two wrappers become side-by-side
          columns: actions and today on the left, drafts and recent on the
          right. */}
      <div className="flex flex-col lg:grid lg:grid-cols-2 lg:gap-x-2 lg:items-start lg:mt-2">
      <div className="contents lg:block">
      {/* Quick actions */}
      <section className="order-1 px-5 mb-5 grid grid-cols-2 gap-2">
        <Link
          href="/entry"
          className="flex items-center justify-center gap-2 bg-emerald-500 text-white font-semibold py-3 rounded-2xl text-sm"
        >
          <Keyboard className="w-4 h-4" />
          Type it in
        </Link>
        <Link
          href="/capture"
          className="flex items-center justify-center gap-2 bg-white/[0.07] border border-white/[0.08] font-semibold py-3 rounded-2xl text-sm"
        >
          <Camera className="w-4 h-4" />
          Screenshot
        </Link>
      </section>

      {/* Today's Summary */}
      <section className="order-3 px-5 mb-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Today
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/[0.05] rounded-xl p-3 flex flex-col items-center justify-center text-center min-h-[72px]">
            <p className="text-lg font-bold tabular-nums">{todayStats.count}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Transactions</p>
          </div>
          <div className="bg-white/[0.05] rounded-xl p-3 flex flex-col items-center justify-center text-center min-h-[72px]">
            <p className="text-lg font-bold tabular-nums">{formatAmount(todayStats.total)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Total Amount</p>
          </div>
          <div className="bg-white/[0.05] rounded-xl p-3 flex flex-col items-center justify-center text-center min-h-[72px] border border-emerald-500/10">
            <p className="text-lg font-bold text-emerald-400 tabular-nums">
              ₱{todayStats.earnings.toFixed(0)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Earnings</p>
          </div>
        </div>
      </section>

      </div>
      <div className="contents lg:block">
      {/* Waiting for you — drafts that are not counted until confirmed.
          Shared screenshots land here: the share shortcut uploads and this is
          where the operator picks them up. */}
      {pendingCount > 0 && (
        <section className="order-2 px-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-amber-300">
              Waiting for you · {pendingCount}
            </h2>
            {pendingCount > pending.length && (
              <Link href="/transactions" className="text-[11px] text-amber-300 font-medium">
                See all
              </Link>
            )}
          </div>
          <div className="bg-amber-500/[0.07] rounded-2xl overflow-hidden divide-y divide-amber-500/10 border border-amber-500/20">
            {pending.map((d) => {
              const known = d.transaction_type !== "Unknown";
              return (
                <Link
                  key={d.id}
                  href={`/confirm?id=${d.id}`}
                  className="flex items-center gap-3 px-4 py-3 active:bg-white/[0.03]"
                >
                  <span className="relative flex h-2 w-2 flex-shrink-0">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {known ? d.transaction_type : "Type not read"}
                      {d.platform !== "Unknown" && <span className="text-muted-foreground"> · {d.platform}</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatTime(d.created_at)} · not counted yet
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">
                    {d.amount > 0 ? "₱" + d.amount.toLocaleString("en-PH") : "Amount?"}
                  </p>
                  <ChevronRight className="w-4 h-4 text-amber-400/50 flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent Transactions */}
      <section className="order-4 px-5 mb-24">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Recent
          </h2>
          <Link href="/transactions" className="text-[11px] text-emerald-400 font-medium">
            See all
          </Link>
        </div>

        {recentTx.length === 0 ? (
          <div className="bg-white/[0.04] rounded-2xl px-4 py-10 text-center border border-white/[0.05]">
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
            <p className="text-xs text-muted-foreground/50 mt-1">
              Use the buttons above to add your first one.
            </p>
          </div>
        ) : (
          <div className="bg-white/[0.04] rounded-2xl overflow-hidden divide-y divide-white/[0.05] border border-white/[0.05]">
            {recentTx.map((tx) => {
              const cfg = TYPE_CONFIG[tx.transaction_type] ?? { color: "#6B7280", Icon: ArrowDownRight };
              const Icon = cfg.Icon;
              return (
                <Link
                  key={tx.id}
                  href={`/transactions?id=${tx.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 active:bg-white/[0.03]"
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: cfg.color + "18" }}
                  >
                    <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{tx.transaction_type}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {tx.transaction_type === "Wallet Transfer"
                        ? `${tx.platform} → ${tx.transfer_to ?? "?"}`
                        : maskNumber(tx.account_number)} · {formatTime(tx.created_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold tabular-nums ${tx.status === "voided" ? "line-through text-muted-foreground" : ""}`}>
                      ₱{tx.amount.toLocaleString("en-PH")}
                    </p>
                    {tx.status === "voided" ? (
                      <p className="text-[11px] text-amber-400 font-medium">Voided</p>
                    ) : tx.transaction_type === "Wallet Transfer" ? (
                      <p className="text-[11px] text-muted-foreground">own money</p>
                    ) : (
                      <p className="text-[11px] text-emerald-400 font-medium tabular-nums">
                        +₱{tx.net_profit.toFixed(0)}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
      </div>
      </div>
    </AppShell>
  );
}
