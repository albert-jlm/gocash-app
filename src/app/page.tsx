"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Loader2, Settings, ArrowDownRight, ArrowUpLeft, Phone,
  Building2, Home, Plus, History, ChevronRight, Zap, TrendingDown,
  CreditCard,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useShareIntent } from "@/hooks/useShareIntent";
import { supabase } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Tailwind gradient classes + glow colour for each wallet
const WALLET_STYLES: Record<string, { gradient: string; glow: string }> = {
  GCash:    { gradient: "from-blue-500 via-blue-600 to-blue-700",     glow: "rgba(59,130,246,0.30)" },
  MariBank: { gradient: "from-purple-500 via-purple-600 to-purple-700", glow: "rgba(139,92,246,0.30)" },
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
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Wallet {
  id: string;
  wallet_name: string;
  balance: number;
}

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

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
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

      const [walletsRes, pendingRes, todayTxRes, recentRes] = await Promise.all([
        supabase
          .from("wallets")
          .select("id, wallet_name, balance")
          .eq("operator_id", opId)
          .order("wallet_type"),
        supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("operator_id", opId)
          .eq("status", "awaiting_confirm"),
        supabase
          .from("transactions")
          .select("amount, net_profit")
          .eq("operator_id", opId)
          .in("status", ["confirmed", "edited"])
          .gte("created_at", todayStart.toISOString()),
        supabase
          .from("transactions")
          .select("id, transaction_type, account_number, amount, net_profit, created_at, status")
          .eq("operator_id", opId)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      if (walletsRes.data) setWallets(walletsRes.data);
      setPendingCount(pendingRes.count ?? 0);

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
  }, [operatorId]);

  if (authLoading || dataLoading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground max-w-[390px] mx-auto">
      {/* Header */}
      <header className="px-5 pt-14 pb-5 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium tracking-widest uppercase text-muted-foreground">
            Good {getTimeOfDay()}
          </p>
          <h1 className="text-xl font-semibold mt-0.5">GoCash Tracker</h1>
        </div>
        <Link
          href="/settings"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center"
        >
          <Settings className="w-4 h-4 text-muted-foreground" />
        </Link>
      </header>

      {/* Wallet Cards — horizontal snap scroll (21st.dev design) */}
      <section className="mb-4">
        <div
          ref={walletScrollRef}
          onScroll={handleWalletScroll}
          className="flex gap-3 px-5 overflow-x-auto pb-2 cursor-grab"
          style={{ scrollbarWidth: "none", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >
          {wallets.map((w) => {
            const style = WALLET_STYLES[w.wallet_name] ?? DEFAULT_WALLET_STYLE;
            return (
              <div key={w.id} className="flex-shrink-0 w-[280px]" style={{ scrollSnapAlign: "start" }}>
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
                    <p className="text-white/80 text-sm font-medium">{w.wallet_name}</p>
                  </div>

                  {/* Balance */}
                  <div className="relative z-10">
                    <p className="text-[11px] text-white/50 font-medium mb-0.5 uppercase tracking-widest">Balance</p>
                    <p className="text-white text-[28px] font-bold tracking-tight tabular-nums leading-none">
                      {formatBalance(w.balance)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress dots */}
        {wallets.length > 1 && (
          <div className="flex justify-center gap-1.5 mt-3">
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

      {/* Pending Banner */}
      {pendingCount > 0 && (
        <section className="px-5 mb-5">
          <Link
            href="/transactions"
            className="flex items-center gap-3 bg-amber-500/[0.10] border border-amber-500/20 rounded-2xl px-4 py-3"
          >
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
            </span>
            <p className="text-sm text-amber-300 flex-1 font-medium">
              {pendingCount} {pendingCount === 1 ? "transaction needs" : "transactions need"} your review
            </p>
            <ChevronRight className="w-4 h-4 text-amber-400/50 flex-shrink-0" />
          </Link>
        </section>
      )}

      {/* Today's Summary */}
      <section className="px-5 mb-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Today
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/[0.05] rounded-xl p-3 flex flex-col items-center justify-center">
            <p className="text-lg font-bold tabular-nums">{todayStats.count}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Transactions</p>
          </div>
          <div className="bg-white/[0.05] rounded-xl p-3 flex flex-col items-center justify-center">
            <p className="text-lg font-bold tabular-nums">{formatAmount(todayStats.total)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Total Amount</p>
          </div>
          <div className="bg-white/[0.05] rounded-xl p-3 flex flex-col items-center justify-center border border-emerald-500/10">
            <p className="text-lg font-bold text-emerald-400 tabular-nums">
              ₱{todayStats.earnings.toFixed(0)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Earnings</p>
          </div>
        </div>
      </section>

      {/* Recent Transactions */}
      <section className="px-5 mb-24">
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
              Tap &quot;New Transaction&quot; below to add your first one.
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
                      {maskNumber(tx.account_number)} · {formatTime(tx.created_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      ₱{tx.amount.toLocaleString("en-PH")}
                    </p>
                    <p className="text-[11px] text-emerald-400 font-medium tabular-nums">
                      +₱{tx.net_profit.toFixed(0)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] px-5 pb-8 pt-4 bg-gradient-to-t from-background via-background/95 to-transparent">
        <nav className="flex items-center justify-around">
          <Link href="/" className="flex flex-col items-center gap-1 min-w-[48px]">
            <Home className="w-5 h-5 text-foreground" />
            <span className="text-[10px] text-foreground font-medium">Home</span>
          </Link>
          <Link href="/capture" className="flex flex-col items-center gap-1 min-w-[48px]">
            <Plus className="w-5 h-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">New</span>
          </Link>
          <Link href="/transactions" className="flex flex-col items-center gap-1 min-w-[48px]">
            <History className="w-5 h-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">History</span>
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
