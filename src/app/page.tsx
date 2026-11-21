"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Loader2, ArrowDown, ArrowUp, Smartphone, ReceiptText, Ellipsis,
  ChevronRight, ChevronDown, AlertCircle, Check,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useShareIntent } from "@/hooks/useShareIntent";
import { supabase } from "@/lib/supabase/client";
import { newIdempotencyKey, voidTransaction } from "@/lib/ledger";
import { typeName } from "@/lib/display";
import { AppShell } from "@/components/app-shell";

const ACTIONS: { label: string; href: string; Icon: React.ElementType }[] = [
  { label: "Cash In",  href: "/entry?type=Cash%20In",       Icon: ArrowDown },
  { label: "Cash Out", href: "/entry?type=Cash%20Out",      Icon: ArrowUp },
  { label: "Load",     href: "/entry?type=Telco%20Load",    Icon: Smartphone },
  { label: "Bills",    href: "/entry?type=Bills%20Payment", Icon: ReceiptText },
  { label: "More",     href: "/new",                        Icon: Ellipsis },
];

const WALLET_STEP = 160;

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

function pesos(n: number): string {
  const whole = Number.isInteger(n);
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

function splitAmount(n: number): [string, string] {
  const [whole, cents] = n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(".");
  return [whole, cents];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

let lastHome: {
  wallets: AccountBalance[];
  pendingCount: number;
  pending: PendingRow[];
  todayStats: { count: number; total: number; earnings: number };
  recentTx: TxRow[];
} | null = null;

export default function Dashboard() {
  const { operatorId, role, loading: authLoading } = useAuthGuard();
  useShareIntent();

  const [wallets, setWallets] = useState<AccountBalance[]>(lastHome?.wallets ?? []);
  const [pendingCount, setPendingCount] = useState(lastHome?.pendingCount ?? 0);
  const [pending, setPending] = useState<PendingRow[]>(lastHome?.pending ?? []);
  const [loadError, setLoadError] = useState(false);
  // "Saved · Undo": the transaction just recorded, for a few seconds.
  const [justSaved, setJustSaved] = useState<TxRow | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const undoKey = useRef<string>(newIdempotencyKey("undo"));
  const [reloadTick, setReloadTick] = useState(0);
  const [todayStats, setTodayStats] = useState(lastHome?.todayStats ?? { count: 0, total: 0, earnings: 0 });
  const [recentTx, setRecentTx] = useState<TxRow[]>(lastHome?.recentTx ?? []);
  const [dataLoading, setDataLoading] = useState(lastHome === null);

  // Wallet scroll snap — progress dot tracking
  const walletScrollRef = useRef<HTMLDivElement>(null);
  const [activeWallet, setActiveWallet] = useState(0);
  const [showDrafts, setShowDrafts] = useState(false);

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
    setActiveWallet(Math.round(el.scrollLeft / WALLET_STEP));
  }, []);

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId; // narrow to string for async closure

    async function fetchData() {

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

      const today = todayTxRes.data
        ? {
            count: todayTxRes.data.length,
            total: todayTxRes.data.reduce((sum, t) => sum + t.amount, 0),
            earnings: todayTxRes.data.reduce((sum, t) => sum + t.net_profit, 0),
          }
        : null;
      const count = pendingRes.count ?? pendingRes.data?.length ?? 0;

      if (walletsRes.data) setWallets(walletsRes.data);
      setPendingCount(count);
      if (pendingRes.data) setPending(pendingRes.data);
      if (today) setTodayStats(today);
      if (recentRes.data) setRecentTx(recentRes.data);

      if (walletsRes.data && pendingRes.data && today && recentRes.data) {
        lastHome = {
          wallets: walletsRes.data,
          pendingCount: count,
          pending: pendingRes.data,
          todayStats: today,
          recentTx: recentRes.data,
        };
      }
      setDataLoading(false);
    }

    fetchData();
  }, [operatorId, reloadTick]);

  // Arriving from a save (/?saved=<id>): show what was saved, with a way back.
  // A wrong tap at the counter is noticed in the first seconds or not at all,
  // so the undo is offered then, in reach, instead of buried in History.
  useEffect(() => {
    if (!operatorId) return;
    const id = new URLSearchParams(window.location.search).get("saved");
    if (!id) return;
    window.history.replaceState(null, "", window.location.pathname);
    let timer: ReturnType<typeof setTimeout> | undefined;
    supabase
      .from("transactions")
      .select("id, transaction_type, platform, transfer_to, account_number, amount, net_profit, created_at, status")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data || data.status !== "confirmed") return;
        setJustSaved(data as TxRow);
        timer = setTimeout(() => setJustSaved(null), 12000);
      });
    return () => { if (timer) clearTimeout(timer); };
  }, [operatorId]);

  async function handleUndo() {
    if (!justSaved || undoing) return;
    setUndoing(true);
    setUndoError(null);
    try {
      await voidTransaction({ transactionId: justSaved.id, idempotencyKey: undoKey.current, reason: "Undone right after saving" });
      setJustSaved(null);
      setReloadTick((n) => n + 1);
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : "Could not undo");
    } finally {
      setUndoing(false);
    }
  }

  if (authLoading || dataLoading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  const ordered = [...wallets].sort((x, y) => Number(y.kind === "cash") - Number(x.kind === "cash"));
  const [totalWhole, totalCents] = splitAmount(wallets.reduce((sum, w) => sum + w.natural_balance, 0));

  return (
    <AppShell active="home" tabBar wide>
      <section className="px-6 pt-[calc(env(safe-area-inset-top)+1.75rem)] lg:pt-10">
        <p className="text-[13px] text-muted-foreground">Total on hand</p>
        <p className="amount text-[46px] font-semibold leading-[1.05] tracking-tight">
          <span className="text-2xl font-medium text-muted-foreground align-[13px] mr-0.5">₱</span>
          {totalWhole}
          <span className="text-2xl text-muted-foreground">.{totalCents}</span>
        </p>
      </section>

      <section className="mt-5">
        <div
          ref={walletScrollRef}
          onScroll={handleWalletScroll}
          className="flex gap-2.5 px-6 scroll-pl-6 overflow-x-auto cursor-grab sm:grid sm:grid-cols-4 sm:overflow-visible sm:cursor-default"
          style={{ scrollbarWidth: "none", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >
          {ordered.map((w) => {
            const cash = w.kind === "cash";
            return (
              <div
                key={w.account_id}
                className={`flex-shrink-0 w-[150px] sm:w-auto h-[88px] rounded-[20px] px-4 py-3.5 flex flex-col justify-between ${
                  cash ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
                style={{ scrollSnapAlign: "start" }}
              >
                <p className={`text-[13px] ${cash ? "opacity-75" : "text-muted-foreground"}`}>
                  {cash ? "Cash drawer" : w.name}
                </p>
                <p className="amount text-xl font-semibold">{pesos(w.natural_balance)}</p>
              </div>
            );
          })}
        </div>
        {ordered.length > 2 && (
          <div className="flex justify-center gap-[5px] mt-2.5 sm:hidden" aria-hidden>
            {ordered.map((_, i) => (
              <span
                key={i}
                className={`h-[5px] rounded-full transition-all ${i === activeWallet ? "w-3.5 bg-foreground" : "w-[5px] bg-input"}`}
              />
            ))}
          </div>
        )}
      </section>

      <nav aria-label="New transaction" className="grid grid-cols-5 px-6 mt-5 sm:max-w-md">
        {ACTIONS.map(({ label, href, Icon }) => (
          <Link key={label} href={href} className="flex flex-col items-center gap-1.5 text-xs font-medium">
            <span className="w-[50px] h-[50px] rounded-full bg-action text-action-foreground grid place-items-center">
              <Icon className="w-[22px] h-[22px]" strokeWidth={1.9} />
            </span>
            {label}
          </Link>
        ))}
      </nav>

      {justSaved && (
        <section className="px-6 mt-5" role="status">
          <div className="flex items-center gap-3 bg-muted rounded-2xl px-4 py-3">
            <Check className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm flex-1 min-w-0">
              <span className="font-medium">Saved</span>
              <span className="text-muted-foreground">
                {" · "}{typeName(justSaved.transaction_type)} ₱{justSaved.amount.toLocaleString("en-PH")}
              </span>
            </p>
            {role === "owner" ? (
              <button
                type="button"
                onClick={handleUndo}
                disabled={undoing}
                className="text-sm font-semibold underline underline-offset-4 px-2 py-2 -my-2 disabled:opacity-50 flex-shrink-0"
              >
                {undoing ? "Undoing…" : "Undo"}
              </button>
            ) : (
              <Link href={`/transactions?id=${justSaved.id}`} className="text-sm font-semibold underline underline-offset-4 flex-shrink-0">View</Link>
            )}
          </div>
          {undoError && <p className="text-xs text-destructive mt-1.5 px-1">{undoError}</p>}
        </section>
      )}

      {loadError && (
        <section className="px-6 mt-5">
          <button
            type="button"
            onClick={() => setReloadTick((n) => n + 1)}
            className="w-full flex items-center gap-3 bg-destructive/10 rounded-2xl px-4 py-3 text-left"
          >
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive flex-1">
              Couldn&apos;t load everything. Tap to try again.
            </p>
          </button>
        </section>
      )}

      <div className="lg:grid lg:grid-cols-2 lg:gap-x-6 lg:items-start">
        {pendingCount > 0 && (
          <section className="px-6 mt-5">
            <button
              type="button"
              onClick={() => setShowDrafts((v) => !v)}
              aria-expanded={showDrafts}
              className="w-full flex items-center gap-2.5 bg-muted rounded-2xl pl-4 pr-3.5 h-12 text-sm font-medium text-left"
            >
              <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
              <span className="flex-1">
                {pendingCount} {pendingCount === 1 ? "draft" : "drafts"} to review
              </span>
              {showDrafts
                ? <ChevronDown className="w-[18px] h-[18px] opacity-60" />
                : <ChevronRight className="w-[18px] h-[18px] opacity-60" />}
            </button>
            {showDrafts && (
              <div className="mt-1">
                {pending.map((d) => (
                  <Link
                    key={d.id}
                    href={`/confirm?id=${d.id}`}
                    className="flex items-center justify-between gap-3 py-3 border-b border-border"
                  >
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium truncate">{typeName(d.transaction_type)}</p>
                      <p className="text-[13px] text-muted-foreground">
                        {d.platform !== "Unknown" ? `${d.platform} · ` : ""}{formatTime(d.created_at)}
                      </p>
                    </div>
                    <p className="amount text-[15px] font-semibold">
                      {d.amount > 0 ? d.amount.toLocaleString("en-PH") : "Amount?"}
                    </p>
                  </Link>
                ))}
                {pendingCount > pending.length && (
                  <Link href="/transactions" className="block py-3 text-sm font-medium underline underline-offset-4">
                    See all {pendingCount}
                  </Link>
                )}
              </div>
            )}
          </section>
        )}

        <section className="px-6 mt-5 pb-8">
          <div className="flex items-center justify-between text-[13px]">
            <Link href="/transactions" className="text-muted-foreground flex items-center gap-0.5">
              Recent <ChevronRight className="w-3.5 h-3.5" />
            </Link>
            <span className="bg-spark text-spark-foreground font-medium rounded-[5px] px-1.5 py-px">
              {pesos(todayStats.earnings)} earned today
            </span>
          </div>

          {recentTx.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8">Nothing recorded yet.</p>
          ) : (
            recentTx.map((tx) => {
              const voided = tx.status === "voided";
              const transfer = tx.transaction_type === "Wallet Transfer";
              return (
                <Link
                  key={tx.id}
                  href={`/transactions?id=${tx.id}`}
                  className="flex items-center justify-between gap-3 py-3 border-b border-border last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className={`text-[15px] font-medium ${voided ? "line-through text-muted-foreground" : ""}`}>
                      {typeName(tx.transaction_type)}
                    </p>
                    <p className="text-[13px] text-muted-foreground truncate">
                      {transfer ? `${tx.platform} → ${tx.transfer_to ?? "?"}` : tx.platform} · {formatTime(tx.created_at)}
                      {voided ? " · voided" : ""}
                    </p>
                  </div>
                  <p className={`amount text-[15px] font-semibold flex items-center gap-1.5 ${voided ? "line-through text-muted-foreground" : ""}`}>
                    {tx.amount.toLocaleString("en-PH")}
                    {!voided && !transfer && (
                      <span className="bg-spark text-spark-foreground text-[13px] font-medium rounded-[5px] px-1.5 py-px">
                        +{tx.net_profit.toFixed(0)}
                      </span>
                    )}
                  </p>
                </Link>
              );
            })
          )}
        </section>
      </div>
    </AppShell>
  );
}
