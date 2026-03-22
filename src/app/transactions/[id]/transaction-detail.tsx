"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Loader2, AlertCircle,
  ArrowDownRight, ArrowUpLeft, Phone, Building2, Zap, TrendingDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuthGuard } from "@/hooks/useAuthGuard";

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
          if (data.status === "awaiting_confirm") {
            router.replace(`/confirm?id=${transactionId}`);
            return;
          }
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
            <p className="text-xl font-bold tabular-nums">₱{tx.amount.toLocaleString("en-PH")}</p>
            <p className="text-sm text-emerald-400 font-semibold tabular-nums">+₱{tx.net_profit.toFixed(2)}</p>
          </div>
        </div>
      </section>

      <section className="px-5 flex-1">
        <div className="bg-white/[0.05] rounded-2xl p-4 space-y-4">
          {imageUrl && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Original screenshot
              </p>
              {/* Signed URLs come from Supabase Storage at runtime, so plain img is the simplest fit here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="Original transaction screenshot"
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
            value={tx.was_edited ? "Saved (edited)" : "Saved"}
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

      <div className="px-5 py-8">
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
