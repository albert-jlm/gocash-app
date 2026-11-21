"use client";

import Link from "next/link";
import { Fragment, useState, useEffect, useRef, useCallback } from "react";
import {
  Loader2, ArrowDown, ArrowUp, Smartphone, ReceiptText, Ellipsis,
  ChevronRight, ChevronDown, AlertCircle, Check,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useShareIntent } from "@/hooks/useShareIntent";
import { supabase } from "@/lib/supabase/client";
import { newIdempotencyKey, setEarnings, voidTransaction } from "@/lib/ledger";
import { parsePesosInput } from "@core/money.ts";
import { formatAmountInput } from "@/lib/display";
import { Sheet } from "@/components/sheet";
import { readFloors, type Floors } from "@/lib/low-balance";
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
  earnings: number | null;
  floors: Floors;
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
  const [earningsHeld, setEarningsHeld] = useState<number | null>(lastHome?.earnings ?? null);
  const [floors, setFloors] = useState<Floors>(lastHome?.floors ?? {});
  const [dataLoading, setDataLoading] = useState(lastHome === null);

  // Wallet scroll snap — progress dot tracking
  const walletScrollRef = useRef<HTMLDivElement>(null);
  const [activeWallet, setActiveWallet] = useState(0);
  const [showDrafts, setShowDrafts] = useState(false);
  const [earningsOpen, setEarningsOpen] = useState(false);
  const [earningsEditing, setEarningsEditing] = useState(false);
  const [earningsInput, setEarningsInput] = useState("");
  const [earningsSaving, setEarningsSaving] = useState(false);
  const [earningsError, setEarningsError] = useState<string | null>(null);
  const earningsKey = useRef<string>(newIdempotencyKey("earnings"));
  const closeEarnings = useCallback(() => {
    setEarningsOpen(false);
    setEarningsEditing(false);
    setEarningsError(null);
  }, []);

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

      const [walletsRes, pendingRes, todayTxRes, recentRes, revenueRes, takenRes, settingsRes] = await Promise.all([
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
        supabase
          .from("account_balances")
          .select("natural_balance")
          .eq("operator_id", opId)
          .eq("kind", "revenue"),
        supabase
          .from("transactions")
          .select("amount")
          .eq("operator_id", opId)
          .eq("status", "confirmed")
          .eq("transaction_type", "Profit Remittance"),
        supabase.from("operators").select("settings").eq("id", opId).maybeSingle(),
      ]);

      // A failed query used to be ignored, so being offline looked like an
      // account with no wallets and no transactions.
      if (walletsRes.error || pendingRes.error || todayTxRes.error || recentRes.error || revenueRes.error || takenRes.error) {
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

      const held = revenueRes.data && takenRes.data
        ? Math.round(
            (revenueRes.data.reduce((sum, r) => sum + r.natural_balance, 0) -
              takenRes.data.reduce((sum, t) => sum + t.amount, 0)) * 100,
          ) / 100
        : null;
      if (held !== null) setEarningsHeld(held);
      const nextFloors = settingsRes.data ? readFloors(settingsRes.data.settings) : null;
      if (nextFloors) setFloors(nextFloors);

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
          earnings: held,
          floors: nextFloors ?? lastHome?.floors ?? {},
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

  async function saveEarnings() {
    const minor = parsePesosInput(earningsInput);
    if (minor === null || minor < 0) {
      setEarningsError("Enter an amount like 1,250 or 1,250.50");
      return;
    }
    setEarningsSaving(true);
    setEarningsError(null);
    try {
      const saved = await setEarnings(minor / 100, earningsKey.current);
      earningsKey.current = newIdempotencyKey("earnings");
      setEarningsHeld(saved);
      if (lastHome) lastHome = { ...lastHome, earnings: saved };
      closeEarnings();
    } catch (err) {
      setEarningsError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setEarningsSaving(false);
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
  const low = ordered.filter((w) => floors[w.name] !== undefined && w.natural_balance < floors[w.name]);
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
          className="flex gap-2.5 px-6 scroll-pl-6 overflow-x-auto cursor-grab sm:grid sm:grid-cols-[repeat(auto-fit,minmax(130px,1fr))] sm:overflow-visible sm:cursor-default"
          style={{ scrollbarWidth: "none", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >
          {ordered.map((w, index) => {
            const cash = w.kind === "cash";
            return (
              <Fragment key={w.account_id}>
              <div
                className={`flex-shrink-0 w-[150px] sm:w-auto h-[88px] rounded-[20px] px-4 py-3.5 flex flex-col justify-between ${
                  cash ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
                style={{ scrollSnapAlign: "start" }}
              >
                <p className={`text-[13px] flex items-center justify-between ${cash ? "opacity-75" : "text-muted-foreground"}`}>
                  {cash ? "Cash drawer" : w.name}
                  {low.includes(w) && (
                    <span className="flex items-center gap-1 text-destructive font-semibold opacity-100">
                      <span className="w-1.5 h-1.5 rounded-full bg-destructive" />Low
                    </span>
                  )}
                </p>
                <p className="amount text-xl font-semibold">{pesos(w.natural_balance)}</p>
              </div>
              {index === 0 && earningsHeld !== null && (
            <button
              type="button"
              disabled={role !== "owner"}
              onClick={() => {
                setEarningsInput(formatAmountInput(String(earningsHeld)));
                setEarningsOpen(true);
              }}
              className="flex-shrink-0 w-[150px] sm:w-auto h-[88px] rounded-[20px] px-4 py-3.5 flex flex-col justify-between text-left bg-spark text-spark-foreground dark:border dark:border-primary/60"
              style={{ scrollSnapAlign: "start" }}
            >
              <p className="text-[13px] opacity-75">Earnings</p>
              <p className="amount text-xl font-semibold">{pesos(earningsHeld)}</p>
            </button>
          )}
              </Fragment>
            );
          })}
        </div>
        {ordered.length > 2 && (
          <div className="flex justify-center gap-[5px] mt-2.5 sm:hidden" aria-hidden>
            {[...ordered, ...(earningsHeld !== null ? [null] : [])].map((_, i) => (
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

      {low.length > 0 && (
        <section className="px-6 mt-5 space-y-2" role="status">
          {low.map((w) => (
            <Link
              key={w.account_id}
              href="/entry?type=Wallet%20Transfer"
              className="flex items-center gap-3 rounded-2xl border border-destructive/50 bg-destructive/[0.07] pl-4 pr-3.5 py-3"
            >
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-semibold">Top up {w.kind === "cash" ? "the cash drawer" : w.name}</span>
                <span className="block text-[13px] text-muted-foreground">
                  {pesos(w.natural_balance)} left · keep above {pesos(floors[w.name])}
                </span>
              </span>
              <ChevronRight className="w-[18px] h-[18px] opacity-60 flex-shrink-0" />
            </Link>
          ))}
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
      <Sheet open={earningsOpen} onClose={closeEarnings} title="Earnings">
        <p className="amount text-[34px] font-semibold tracking-tight">{pesos(earningsHeld ?? 0)}</p>
        <p className="text-sm text-muted-foreground mb-5">Fees earned and not yet taken out.</p>

        {earningsEditing ? (
          <>
            <label htmlFor="earnings-amount" className="text-[13px] text-muted-foreground">Correct amount</label>
            <div className="relative mt-1.5">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">₱</span>
              <input
                id="earnings-amount"
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                value={earningsInput}
                onChange={(e) => setEarningsInput(formatAmountInput(e.target.value))}
                className="amount w-full h-[54px] rounded-2xl bg-muted pl-9 pr-4 text-xl font-semibold"
              />
            </div>
            <p className="text-[13px] text-muted-foreground mt-2">
              The change is kept on record. Drawer and wallet balances do not move.
            </p>
            {earningsError && <p className="text-sm text-destructive mt-2">{earningsError}</p>}
            <button
              type="button"
              onClick={saveEarnings}
              disabled={earningsSaving}
              className="font-heading mt-4 w-full h-[54px] rounded-full bg-primary text-primary-foreground font-semibold text-[17px] disabled:opacity-60"
            >
              {earningsSaving ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
          <div className="space-y-2.5">
            <Link
              href="/entry?type=Profit%20Remittance"
              className="font-heading w-full h-[54px] rounded-full bg-primary text-primary-foreground font-semibold text-[17px] flex items-center justify-center"
            >
              Take out profit
            </Link>
            <button
              type="button"
              onClick={() => setEarningsEditing(true)}
              className="font-heading w-full h-[54px] rounded-full bg-muted font-semibold text-[17px]"
            >
              Edit amount
            </button>
          </div>
        )}
      </Sheet>
    </AppShell>
  );
}
