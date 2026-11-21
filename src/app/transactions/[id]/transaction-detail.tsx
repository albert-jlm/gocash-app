"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Loader2, AlertCircle, Undo2,
  ArrowDownRight, ArrowUpLeft, Phone, Building2, Zap, TrendingDown,
  ArrowLeftRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { newIdempotencyKey, voidTransaction } from "@/lib/ledger";
import { typeName } from "@/lib/display";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Sheet } from "@/components/sheet";
import { dropFromHistory } from "@/lib/history-cache";
import { removeTransaction } from "@/lib/ledger";

const TYPE_CONFIG: Record<string, { color: string; Icon: React.ElementType }> = {
  "Cash In":           { color: "var(--foreground)", Icon: ArrowDownRight },
  "Cash Out":          { color: "var(--foreground)", Icon: ArrowUpLeft },
  "Telco Load":        { color: "var(--foreground)", Icon: Phone },
  "Bills Payment":     { color: "var(--foreground)", Icon: Zap },
  "Bank Transfer":     { color: "var(--foreground)", Icon: Building2 },
  "Profit Remittance": { color: "var(--foreground)", Icon: TrendingDown },
  "Wallet Transfer":   { color: "var(--foreground)", Icon: ArrowLeftRight },
};

interface TxDetail {
  id: string;
  transaction_type: string;
  platform: string;
  transfer_to: string | null;
  platform_fee: number;
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
      <p className="label">{label}</p>
      <p className="text-[15px]">{value}</p>
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
  const { operatorId, role, loading: authLoading } = useAuthGuard();
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
  const [askDelete, setAskDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!tx || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await removeTransaction(tx.id);
      dropFromHistory(tx.id);
      router.replace("/transactions");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete");
      setDeleting(false);
    }
  }

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
      .select("id, transaction_type, platform, transfer_to, platform_fee, account_number, reference_number, amount, net_profit, transaction_date, created_at, status, confirmed_at, was_edited")
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
      <AppShell active="history">
        <div className="flex-1 grid place-items-center">
          <Loader2 className="late w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (fetchError || !tx) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center max-w-[430px] mx-auto px-5">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-[15px] text-destructive">{fetchError ?? "Transaction not found"}</p>
          <Link href="/transactions" className="text-[15px] text-primary block">Back to history</Link>
        </div>
      </div>
    );
  }

  const cfg = TYPE_CONFIG[tx.transaction_type] ?? { color: "var(--foreground)", Icon: ArrowDownRight };
  const Icon = cfg.Icon;
  const isVoided = tx.status === "voided";
  const isTransfer = tx.transaction_type === "Wallet Transfer";
  const statusLabel =
    isVoided ? "Voided — not counted in your balances"
    : tx.status === "confirmed" ? (tx.was_edited ? "Saved (edited)" : "Saved")
    : tx.status;

  return (
    <AppShell active="history">
      <PageHeader title="Transaction" back="/transactions" />

      {duplicate && (
        <section className="px-5 mb-4">
          <div className="flex items-start gap-2.5 bg-warning/[0.10] border border-warning/20 rounded-2xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-warning leading-relaxed">
              This receipt was already recorded, so nothing new was added. This is
              the transaction it matches.
            </p>
          </div>
        </section>
      )}

      <section className="px-5 mb-5">
        <div className="bg-muted rounded-2xl p-5 flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "var(--muted)" }}
          >
            <Icon className="w-6 h-6" style={{ color: cfg.color }} />
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold">{typeName(tx.transaction_type)}</p>
            <p className="text-[13px] text-muted-foreground">
              {isTransfer ? `${tx.platform} → ${tx.transfer_to ?? "?"}` : tx.platform}
            </p>
          </div>
          <div className="text-right">
            <p className={`text-xl font-bold tabular-nums ${isVoided ? "line-through text-muted-foreground" : ""}`}>
              ₱{tx.amount.toLocaleString("en-PH")}
            </p>
            {isVoided ? (
              <p className="text-[13px] font-semibold text-warning">Voided</p>
            ) : isTransfer ? (
              <p className="text-[13px] text-muted-foreground">own money, nothing earned</p>
            ) : (
              <p className="text-[15px] text-primary font-semibold tabular-nums">+₱{tx.net_profit.toFixed(2)}</p>
            )}
          </div>
        </div>
      </section>

      <section className="px-5 flex-1">
        <div className="bg-muted rounded-2xl p-4 space-y-4">
          {isTransfer && (
            <>
              <Field label="From" value={tx.platform === "Cash" ? "Cash drawer" : tx.platform} />
              <Field label="To" value={tx.transfer_to === "Cash" ? "Cash drawer" : (tx.transfer_to ?? "—")} />
              {tx.platform_fee > 0 && (
                <Field
                  label="Fee the app charged"
                  value={`₱${tx.platform_fee.toFixed(2)} · recorded as a cost, not taken from earnings`}
                />
              )}
            </>
          )}
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
        {tx.status === "confirmed" && role !== "staff" && !askVoid && (
          <button
            type="button"
            onClick={() => { setAskVoid(true); setVoidError(null); }}
            className="w-full flex items-center justify-center gap-2 bg-destructive/10 border border-destructive/20 text-destructive font-semibold py-3.5 rounded-2xl text-[15px]"
          >
            <Undo2 className="w-4 h-4" />
            Void this transaction
          </button>
        )}

        {tx.status === "confirmed" && role !== "staff" && askVoid && (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] p-4 space-y-3">
            <p className="text-[15px] font-semibold">Void this transaction?</p>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
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
              className="w-full rounded-xl bg-muted px-3 py-2.5 text-[15px]"
            />
            {voidError && <p className="text-[13px] text-destructive">{voidError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAskVoid(false)}
                disabled={voiding}
                className="btn btn-secondary"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={handleVoid}
                disabled={voiding}
                className="btn btn-danger"
              >
                {voiding ? <><Loader2 className="w-4 h-4 animate-spin" /> Voiding…</> : "Yes, void it"}
              </button>
            </div>
          </div>
        )}

        {tx.status === "confirmed" && role === "staff" && (
          <p className="text-[13px] text-muted-foreground text-center leading-relaxed px-2">
            Recorded wrong? Ask the owner or an admin to void it, then enter it again.
          </p>
        )}

        {isVoided && (
          <Link
            href={`/entry?${new URLSearchParams({
              type: tx.transaction_type,
              ...(tx.platform && tx.platform !== "Unknown" ? { platform: tx.platform } : {}),
              ...(tx.amount > 0 ? { amount: String(tx.amount) } : {}),
              ...(tx.transfer_to ? { to: tx.transfer_to } : {}),
              ...(tx.platform_fee > 0 ? { appFee: String(tx.platform_fee) } : {}),
              ...(tx.reference_number ? { ref: tx.reference_number } : {}),
              ...(tx.account_number ? { account: tx.account_number } : {}),
            }).toString()}`}
            className="btn btn-primary w-full"
          >
            Enter it again
          </Link>
        )}

        {isVoided && role !== "staff" && (
          <button type="button" onClick={() => { setAskDelete(true); setDeleteError(null); }} className="btn btn-outline w-full text-destructive">
            Delete for good
          </button>
        )}

        <Link
          href="/transactions"
          className="btn btn-secondary w-full"
        >
          Back to History
        </Link>
      </div>
      <Sheet open={askDelete} onClose={() => setAskDelete(false)} title="Delete this for good?">
        <p className="text-[15px] text-muted-foreground mt-2 mb-5">
          It disappears from History, and its customer number, reference number and receipt are erased. This cannot be undone. Your balances do not change: it was already voided.
        </p>
        {deleteError && <p className="text-[15px] text-destructive mb-3">{deleteError}</p>}
        <div className="space-y-2.5">
          <button type="button" onClick={handleDelete} disabled={deleting} className="btn btn-danger w-full">
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <button type="button" onClick={() => setAskDelete(false)} className="btn btn-secondary w-full">
            Keep it
          </button>
        </div>
      </Sheet>
    </AppShell>
  );
}
