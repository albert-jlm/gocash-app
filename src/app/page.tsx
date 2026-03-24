"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Settings, ArrowDownRight, ArrowUpLeft, Phone,
  Building2, Zap, TrendingDown,
  CreditCard, BarChart3, Banknote, TrendingUp, Camera,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { supabase } from "@/lib/supabase/client";
import { getWalletColor, sortWallets } from "@/lib/platforms";
import { AppBottomNav } from "@/components/app-bottom-nav";
import { SkeletonDashboard } from "@/components/skeleton";

const TYPE_CONFIG: Record<string, { color: string; Icon: React.ElementType }> = {
  "Cash In":           { color: "#10B981", Icon: ArrowDownRight },
  "Cash Out":          { color: "#EF4444", Icon: ArrowUpLeft },
  "Telco Load":        { color: "#8B5CF6", Icon: Phone },
  "Bills Payment":     { color: "#F59E0B", Icon: Zap },
  "Bank Transfer":     { color: "#3B82F6", Icon: Building2 },
  "Profit Remittance": { color: "#6B7280", Icon: TrendingDown },
};

interface Wallet {
  id: string;
  wallet_name: string;
  wallet_type: string;
  balance: number;
  color: string;
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

export default function Dashboard() {
  const { operatorId, loading: authLoading } = useAuthGuard();

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [todayStats, setTodayStats] = useState({ count: 0, total: 0, earnings: 0 });
  const [recentTx, setRecentTx] = useState<TxRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const walletScrollRef = useRef<HTMLDivElement>(null);
  const [activeWallet, setActiveWallet] = useState(0);

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

    const cards = Array.from(el.children) as HTMLElement[];
    if (cards.length === 0) return;

    const viewportCenter = el.scrollLeft + el.clientWidth / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card, index) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const distance = Math.abs(cardCenter - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    setActiveWallet(closestIndex);
  }, []);

  const fetchData = useCallback(async () => {
    if (!operatorId) return;
    setDataLoading(true);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [walletsRes, todayTxRes, recentRes] = await Promise.all([
      supabase
        .from("wallets")
        .select("id, wallet_name, wallet_type, balance, color")
        .eq("operator_id", operatorId)
        .eq("is_active", true),
      supabase
        .from("transactions")
        .select("amount, net_profit")
        .eq("operator_id", operatorId)
        .in("status", ["confirmed", "edited"])
        .gte("created_at", todayStart.toISOString()),
      supabase
        .from("transactions")
        .select("id, transaction_type, account_number, amount, net_profit, created_at, status")
        .eq("operator_id", operatorId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    if (walletsRes.data) setWallets(sortWallets(walletsRes.data));

    if (todayTxRes.data) {
      setTodayStats({
        count: todayTxRes.data.length,
        total: todayTxRes.data.reduce((s, t) => s + t.amount, 0),
        earnings: todayTxRes.data.reduce((s, t) => s + t.net_profit, 0),
      });
    }

    if (recentRes.data) setRecentTx(recentRes.data);
    setDataLoading(false);
  }, [operatorId]);

  useEffect(() => {
    if (!operatorId) return;
    void fetchData();
  }, [operatorId, fetchData]);

  useEffect(() => {
    if (!operatorId) return;

    const channel = supabase
      .channel(`dashboard:${operatorId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "gocash", table: "wallets", filter: `operator_id=eq.${operatorId}` },
        () => { void fetchData(); }
      )
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
      <>
        <SkeletonDashboard />
        <AppBottomNav />
      </>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-4 pb-5 pt-safe sm:px-6 lg:px-8">
        <div>
          <p className="text-[11px] font-medium tracking-widest uppercase text-muted-foreground">
            Good {getTimeOfDay()}
          </p>
          <h1 className="text-xl font-semibold mt-0.5">GoCash Tracker</h1>
        </div>
        <Link
          href="/settings"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center tap-scale"
        >
          <Settings className="w-4 h-4 text-muted-foreground" />
        </Link>
      </header>

      <section className="mb-4 animate-fade-up">
        <div
          ref={walletScrollRef}
          onScroll={handleWalletScroll}
          className="flex gap-4 overflow-x-auto px-4 pb-2 cursor-grab sm:px-6 lg:px-8"
          style={{ scrollbarWidth: "none", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >
          {wallets.map((w) => {
            const style = getWalletColor(w.color);
            return (
              <div key={w.id} className="w-[min(84vw,20rem)] flex-shrink-0 sm:w-[20rem] lg:w-[22rem]" style={{ scrollSnapAlign: "start" }}>
                <div
                  className={`relative h-[160px] rounded-3xl bg-gradient-to-br ${style.gradient} p-6 flex flex-col justify-between overflow-hidden`}
                  style={{ boxShadow: `0 12px 40px -12px ${style.glow}` }}
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -translate-y-8 translate-x-8 pointer-events-none" />
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full blur-xl translate-y-8 -translate-x-8 pointer-events-none" />

                  <div className="relative z-10 flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center flex-shrink-0">
                      <CreditCard className="w-4 h-4 text-white" />
                    </div>
                    <p className="text-white/80 text-sm font-medium">{w.wallet_name}</p>
                  </div>

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

        {wallets.length > 1 && (
          <div className="flex justify-center gap-1.5 mt-3">
            {wallets.map((_, i) => (
              <div
                key={i}
                className="rounded-full transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
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

      <section className="mb-5 px-4 sm:px-6 lg:px-8 animate-fade-up stagger-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Today
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/[0.05] rounded-xl p-3 flex flex-col items-center justify-center text-center min-h-[72px]">
            <div className="w-6 h-6 rounded-lg bg-white/[0.08] flex items-center justify-center mb-1.5">
              <BarChart3 className="w-3 h-3 text-muted-foreground" />
            </div>
            <p className="text-lg font-bold tabular-nums">{todayStats.count}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Transactions</p>
          </div>
          <div className="bg-white/[0.05] rounded-xl p-3 flex flex-col items-center justify-center text-center min-h-[72px]">
            <div className="w-6 h-6 rounded-lg bg-white/[0.08] flex items-center justify-center mb-1.5">
              <Banknote className="w-3 h-3 text-muted-foreground" />
            </div>
            <p className="text-lg font-bold tabular-nums">{formatAmount(todayStats.total)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Total Amount</p>
          </div>
          <div className="bg-white/[0.05] rounded-xl p-3 flex flex-col items-center justify-center text-center min-h-[72px] border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.05)]">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/15 flex items-center justify-center mb-1.5">
              <TrendingUp className="w-3 h-3 text-emerald-400" />
            </div>
            <p className="text-lg font-bold text-emerald-400 tabular-nums">
              ₱{todayStats.earnings.toFixed(0)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Earnings</p>
          </div>
        </div>
      </section>

      <section className="mb-24 px-4 sm:px-6 lg:px-8 animate-fade-up stagger-2">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Recent
          </h2>
          <Link href="/transactions/" className="text-[11px] text-emerald-400 font-medium">
            See all
          </Link>
        </div>

        {recentTx.length === 0 ? (
          <div className="bg-white/[0.04] rounded-2xl px-4 py-10 text-center border border-white/[0.05] animate-fade-up">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.05] flex items-center justify-center mx-auto mb-4">
              <Camera className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
            <p className="text-xs text-muted-foreground/50 mt-1 mb-4">
              Capture a payment receipt to get started.
            </p>
            <Link
              href="/capture"
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white tap-scale"
            >
              Capture your first receipt
            </Link>
          </div>
        ) : (
          <div className="bg-white/[0.04] rounded-2xl overflow-hidden divide-y divide-white/[0.05] border border-white/[0.05]">
            {recentTx.map((tx, i) => {
              const cfg = TYPE_CONFIG[tx.transaction_type] ?? { color: "#6B7280", Icon: ArrowDownRight };
              const Icon = cfg.Icon;
              return (
                <Link
                  key={tx.id}
                  href={`/transactions/?id=${tx.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 active:bg-white/[0.03] hover:bg-white/[0.02] tap-scale animate-fade-up"
                  style={{ animationDelay: `${Math.min(i, 4) * 50}ms` }}
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

      <AppBottomNav />
    </div>
  );
}
