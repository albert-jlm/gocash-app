"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Loader2, AlertCircle, Trash2,
  ArrowDownRight, ArrowUpLeft, Phone, Building2, Zap, TrendingDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SkeletonTransactionDetail } from "@/components/skeleton";
import { storeToast, consumeStoredToast } from "@/lib/toast-store";

const TRANSACTIONS_HISTORY_HREF = "/transactions/";

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
  image_url: string | null;
  amount: number;
  net_profit: number;
  transaction_date: string | null;
  created_at: string;
  status: string;
  confirmed_at: string | null;
  was_edited: boolean;
}

function formatStatusLabel(tx: TxDetail): string {
  if (tx.status === "edited") return "Saved (edited)";
  if (tx.status === "confirmed") return "Saved";

  return tx.status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

export default function TransactionDetail({ transactionId }: { transactionId: string }) {
  const { operatorId, loading: authLoading } = useAuthGuard();
  const router = useRouter();

  const [tx, setTx] = useState<TxDetail | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => { consumeStoredToast(); }, []);

  function goToTransactionsHistory() {
    window.location.assign(TRANSACTIONS_HISTORY_HREF);
  }

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId;

    supabase
      .from("transactions")
      .select("id, transaction_type, platform, account_number, reference_number, image_url, amount, net_profit, transaction_date, created_at, status, confirmed_at, was_edited")
      .eq("id", transactionId)
      .eq("operator_id", opId)
      .single()
      .then(async ({ data, error }) => {
        if (error || !data) {
          setFetchError("Transaction not found");
        } else {
          const detail = data as TxDetail;
          setTx(detail);

          if (detail.image_url) {
            const { data: signed } = await supabase.storage
              .from("transaction-images")
              .createSignedUrl(detail.image_url, 60 * 5);

            setImageUrl(signed?.signedUrl ?? null);
          } else {
            setImageUrl(null);
          }
        }
        setDataLoading(false);
      });
  }, [operatorId, transactionId, router]);

  function handleDeleteClick() {
    if (!tx) return;
    setShowDeleteDialog(true);
  }

  async function confirmDelete() {
    if (!tx) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/login"); return; }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-transaction`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ transaction_id: tx.id }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete");
      storeToast("Transaction deleted");
      goToTransactionsHistory();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Something went wrong");
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  }

  if (authLoading || dataLoading) {
    return <SkeletonTransactionDetail />;
  }

  if (fetchError || !tx) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-4xl items-center justify-center bg-background px-5">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="text-sm text-red-400">{fetchError ?? "Transaction not found"}</p>
          <a href={TRANSACTIONS_HISTORY_HREF} className="text-sm text-blue-400 block">Back to history</a>
        </div>
      </div>
    );
  }

  const cfg = TYPE_CONFIG[tx.transaction_type] ?? { color: "#6B7280", Icon: ArrowDownRight };
  const Icon = cfg.Icon;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 px-4 pb-4 pt-safe sm:px-6 lg:px-8">
        <a
          href={TRANSACTIONS_HISTORY_HREF}
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </a>
        <div>
          <h1 className="text-base font-semibold">Transaction Details</h1>
          <p className="text-xs text-muted-foreground">
            {new Date(tx.created_at).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </header>

      <section className="mb-5 px-4 sm:px-6 lg:px-8 animate-scale-in">
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
            <p className="text-xl font-bold tabular-nums">₱{tx.amount.toLocaleString("en-PH")}</p>
            <p className="text-sm text-emerald-400 font-semibold tabular-nums">+₱{tx.net_profit.toFixed(2)}</p>
          </div>
        </div>
      </section>

      <section className="flex-1 px-4 sm:px-6 lg:px-8 animate-fade-up" style={{ animationDelay: "100ms" }}>
        <div className="bg-white/[0.05] rounded-2xl p-4 space-y-4">
          {imageUrl && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Original screenshot
              </p>
              <Image
                src={imageUrl}
                alt="Original transaction screenshot"
                width={1200}
                height={1600}
                unoptimized
                className="w-full rounded-2xl border border-white/[0.06] bg-black/20 object-cover"
              />
            </div>
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
            value={formatStatusLabel(tx)}
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

      <div className="space-y-3 px-4 py-8 sm:px-6 lg:px-8 animate-fade-up" style={{ animationDelay: "200ms" }}>
        {deleteError && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{deleteError}</p>
          </div>
        )}
        <Link
          href={`/confirm?id=${transactionId}`}
          className="w-full flex items-center justify-center bg-emerald-500 text-white font-semibold py-3.5 rounded-2xl text-sm tap-scale hover:bg-emerald-400 active:bg-emerald-600 transition-colors"
        >
          Edit Transaction
        </Link>
        <button
          onClick={handleDeleteClick}
          disabled={deleting}
          className="w-full flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 font-medium py-3.5 rounded-2xl text-sm hover:bg-red-500/20 transition-all disabled:opacity-50 tap-scale"
        >
          {deleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
          Delete Transaction
        </button>
        <a
          href={TRANSACTIONS_HISTORY_HREF}
          className="w-full flex items-center justify-center bg-white/[0.07] text-muted-foreground font-medium py-3.5 rounded-2xl text-sm tap-scale hover:bg-white/[0.11] transition-colors"
        >
          Back to History
        </a>
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete this transaction?"
        description="This will reverse any wallet balance changes and permanently remove the record."
        confirmLabel="Delete Transaction"
        confirmVariant="destructive"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </div>
  );
}
