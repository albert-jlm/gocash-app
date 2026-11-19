"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Loader2, AlertCircle, Undo2,
  ArrowDownRight, ArrowUpLeft, Phone, Building2, Zap, TrendingDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { newIdempotencyKey, voidTransaction } from "@/lib/ledger";

const TYPE_CONFIG: Record<string, { color: string; Icon: React.ElementType }> = {
  "Cash In":           { color: "#10B981", Icon: ArrowDownRight },
  "Cash Out":          { color: "#EF4444", Icon: ArrowUpLeft },
  "Telco Load":        { color: "#8B5CF6", Icon: Phone },
  "Bills Payment":     { color: "#F59E0B", Icon: Zap },
  "Bank Transfer":     { color: "#3B82F6", Icon: Building2 },
  "Profit Remittance": { color: "#6B7280", Icon: TrendingDown },
};

interface TxDetail {
  id: string;
  transaction_type: string;
  platform: string;
  account_number: string | null;
  reference_number: string | null;
  amount: number;
  net_profit: number;
  transaction_date: string | null;
  created_at: string;
  status: string;
  confirmed_at: string | null;
  was_edited: boolean;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

export default function TransactionDetail({
  transactionId,
  duplicate = false,
}: {
  transactionId: string;
  /** Arrived here because a screenshot of this same receipt was captured again. */
  duplicate?: boolean;
}) {
  const { operatorId, loading: authLoading } = useAuthGuard();
  const router = useRouter();

  const [tx, setTx] = useState<TxDetail | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  // Void is two taps on purpose: it moves balances back and cannot be undone
  // (the fix for a mistaken void is to enter the transaction again).
  const voidKey = useRef<string>(newIdempotencyKey("void"));
  const [askVoid, setAskVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  async function handleVoid() {
    if (!tx || voiding) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await voidTransaction({
        transactionId: tx.id,
        idempotencyKey: voidKey.current,
        reason: voidReason,
      });
      setTx({ ...tx, status: "voided" });
      setAskVoid(false);
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : "Could not void the transaction");
    } finally {
      setVoiding(false);
    }
  }

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId;

    supabase
      .from("transactions")
      .select("id, transaction_type, platform, account_number, reference_number, amount, net_profit, transaction_date, created_at, status, confirmed_at, was_edited")
      .eq("id", transactionId)
      .eq("operator_id", opId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setFetchError("Transaction not found");
        } else {
          if (data.status === "awaiting_confirm") {
            router.replace(`/confirm?id=${transactionId}`);
            return;
          }
          setTx(data as TxDetail);
        }
        setDataLoading(false);
      });
  }, [operatorId, transactionId, router]);

  if (authLoading || dataLoading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  if (fetchError || !tx) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center max-w-[390px] mx-auto px-5">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="text-sm text-red-400">{fetchError ?? "Transaction not found"}</p>
          <Link href="/transactions" className="text-sm text-blue-400 block">Back to history</Link>
        </div>
      </div>
    );
  }

  const cfg = TYPE_CONFIG[tx.transaction_type] ?? { color: "#6B7280", Icon: ArrowDownRight };
  const Icon = cfg.Icon;
  const isVoided = tx.status === "voided";
  const statusLabel =
    isVoided ? "Voided — not counted in your balances"
    : tx.status === "confirmed" ? (tx.was_edited ? "Saved (edited)" : "Saved")
    : tx.status;

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground max-w-[390px] mx-auto">
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link
          href="/transactions"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <div>
          <h1 className="text-base font-semibold">Transaction Details</h1>
          <p className="text-xs text-muted-foreground">
            {new Date(tx.created_at).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </header>

      {duplicate && (
        <section className="px-5 mb-4">
          <div className="flex items-start gap-2.5 bg-amber-500/[0.10] border border-amber-500/20 rounded-2xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200 leading-relaxed">
              This receipt was already recorded, so nothing new was added. This is
              the transaction it matches.
            </p>
          </div>
        </section>
      )}

      <section className="px-5 mb-5">
        <div className="bg-white/[0.05] rounded-2xl p-5 flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: cfg.color + "20" }}
          >
            <Icon className="w-6 h-6" style={{ color: cfg.color }} />
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold">{tx.transaction_type}</p>
            <p className="text-xs text-muted-foreground">{tx.platform}</p>
          </div>
          <div className="text-right">
            <p className={`text-xl font-bold tabular-nums ${isVoided ? "line-through text-muted-foreground" : ""}`}>
              ₱{tx.amount.toLocaleString("en-PH")}
            </p>
            {isVoided ? (
              <p className="text-xs font-semibold text-amber-400">Voided</p>
            ) : (
              <p className="text-sm text-emerald-400 font-semibold tabular-nums">+₱{tx.net_profit.toFixed(2)}</p>
            )}
          </div>
        </div>
      </section>

      <section className="px-5 flex-1">
        <div className="bg-white/[0.05] rounded-2xl p-4 space-y-4">
          {tx.account_number && (
            <Field label="Customer number" value={tx.account_number} />
          )}
          {tx.reference_number && (
            <Field label="Transaction number" value={tx.reference_number} />
          )}
          {tx.transaction_date && (
            <Field
              label="Date & Time"
              value={new Date(tx.transaction_date).toLocaleString("en-PH", {
                month: "short", day: "numeric", year: "numeric",
                hour: "numeric", minute: "2-digit",
              })}
            />
          )}
          <Field
            label="Status"
            value={statusLabel}
          />
          {tx.confirmed_at && (
            <Field
              label="Saved at"
              value={new Date(tx.confirmed_at).toLocaleString("en-PH", {
                month: "short", day: "numeric",
                hour: "numeric", minute: "2-digit",
              })}
            />
          )}
        </div>
      </section>

      <div className="px-5 py-8 space-y-3">
        {/* There is no Edit. A saved transaction is in the ledger; changing it
            means reversing it and entering it again, so that is what is
            offered. The Edit button that used to be here opened the confirm
            form, which could only ever answer "already confirmed". */}
        {tx.status === "confirmed" && !askVoid && (
          <button
            type="button"
            onClick={() => { setAskVoid(true); setVoidError(null); }}
            className="w-full flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 font-semibold py-3.5 rounded-2xl text-sm"
          >
            <Undo2 className="w-4 h-4" />
            Void this transaction
          </button>
        )}

        {tx.status === "confirmed" && askVoid && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4 space-y-3">
            <p className="text-sm font-semibold">Void this transaction?</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Your balances go back to what they were before it. It stays in your
              history marked as voided. If it was recorded wrong, void it and
              enter it again.
            </p>
            <input
              type="text"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Reason (optional), e.g. wrong amount"
              maxLength={120}
              className="w-full rounded-xl bg-white/[0.07] px-3 py-2.5 text-sm"
            />
            {voidError && <p className="text-xs text-red-400">{voidError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAskVoid(false)}
                disabled={voiding}
                className="bg-white/[0.07] text-muted-foreground font-medium py-3 rounded-xl text-sm disabled:opacity-50"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={handleVoid}
                disabled={voiding}
                className="flex items-center justify-center gap-2 bg-red-500 text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50"
              >
                {voiding ? <><Loader2 className="w-4 h-4 animate-spin" /> Voiding…</> : "Yes, void it"}
              </button>
            </div>
          </div>
        )}

        {isVoided && (
          <Link
            href="/entry"
            className="w-full flex items-center justify-center bg-emerald-500 text-white font-semibold py-3.5 rounded-2xl text-sm"
          >
            Enter it again
          </Link>
        )}

        <Link
          href="/transactions"
          className="w-full flex items-center justify-center bg-white/[0.07] text-muted-foreground font-medium py-3.5 rounded-2xl text-sm"
        >
          Back to History
        </Link>
      </div>
    </div>
  );
}
