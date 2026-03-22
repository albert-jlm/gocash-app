"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Check,
  Loader2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransactionDraft {
  id: string;
  platform: string;
  transaction_type: string;
  amount: number;
  net_profit: number;
  account_number: string | null;
  reference_number: string | null;
  transaction_date: string | null;
  status: string;
}

const MOCK_PREVIEW: TransactionDraft = {
  id: "preview",
  platform: "GCash",
  transaction_type: "Cash In",
  amount: 500,
  net_profit: 10,
  account_number: "0917 123 4567",
  reference_number: "891148103",
  transaction_date: "2025-03-08T14:30:00",
  status: "awaiting_confirm",
};

// ---------------------------------------------------------------------------
// Field row — read-only display vs editable input
// ---------------------------------------------------------------------------

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConfirmForm({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const isPreview = transactionId === "preview";

  const [tx, setTx] = useState<TransactionDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [platform, setPlatform] = useState("");
  const [txType, setTxType] = useState("");
  const [amount, setAmount] = useState("");
  const [profit, setProfit] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [txDate, setTxDate] = useState("");

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  useEffect(() => {
    async function load() {
      if (isPreview) {
        populate(MOCK_PREVIEW);
        setTx(MOCK_PREVIEW);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("transactions")
        .select(
          "id, platform, transaction_type, amount, net_profit, account_number, reference_number, transaction_date, status"
        )
        .eq("id", transactionId)
        .single();

      if (error || !data) {
        setFetchError("Transaction not found");
        setLoading(false);
        return;
      }
      const draft = data as TransactionDraft;
      setTx(draft);
      populate(draft);
      setLoading(false);
    }
    load();
  }, [transactionId, isPreview]);

  function populate(data: TransactionDraft) {
    setPlatform(data.platform ?? "GCash");
    setTxType(data.transaction_type ?? "Cash In");
    setAmount(data.amount?.toString() ?? "0");
    setProfit(data.net_profit?.toString() ?? "0");
    setAccountNumber(data.account_number ?? "");
    setReferenceNumber(data.reference_number ?? "");
    setTxDate(data.transaction_date ? data.transaction_date.slice(0, 16) : "");
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async function handleSave() {
    if (!tx || isPreview) return;
    setSaveError(null);
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/login"); return; }

      const edits: Record<string, unknown> = {};
      if (platform !== tx.platform) edits.platform = platform;
      if (txType !== tx.transaction_type) edits.transaction_type = txType;
      if (parseFloat(amount) !== tx.amount) edits.amount = parseFloat(amount);
      if (parseFloat(profit) !== tx.net_profit) edits.net_profit = parseFloat(profit);
      if (accountNumber !== (tx.account_number ?? "")) edits.account_number = accountNumber || null;
      if (referenceNumber !== (tx.reference_number ?? "")) edits.reference_number = referenceNumber || null;
      if (txDate && txDate !== (tx.transaction_date ?? "").slice(0, 16))
        edits.transaction_date = new Date(txDate).toISOString();

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/confirm-transaction`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            transaction_id: tx.id,
            edits: Object.keys(edits).length > 0 ? edits : undefined,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save");
      router.push("/transactions");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center max-w-[390px] mx-auto">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
          <p className="text-sm text-muted-foreground">Loading transaction…</p>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center max-w-[390px] mx-auto px-5">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="text-sm text-red-400">{fetchError}</p>
          <Link href="/" className="text-sm text-emerald-400 block">Go home</Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground max-w-[390px] mx-auto">
      {/* Header */}
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link
          href="/"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold">Review Transaction</h1>
          <p className="text-xs text-muted-foreground">Confirm or fix the details below</p>
        </div>
      </header>

      {/* AI read badge */}
      <section className="px-5 mb-4">
        <div className="flex items-center gap-2.5 bg-emerald-500/8 border border-emerald-500/15 rounded-2xl px-4 py-3">
          <div className="w-7 h-7 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-emerald-400">AI read your screenshot</p>
            <p className="text-[11px] text-muted-foreground">{platform} · edit any field below if needed</p>
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="px-5 flex-1">
        {saveError && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 mb-4">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{saveError}</p>
          </div>
        )}

        <div className="rounded-2xl p-4 space-y-4 mb-4 bg-white/[0.06] border border-white/[0.08]">
          {/* Platform */}
          <FieldRow label="App used">
            <Select value={platform} onValueChange={(v) => setPlatform(v ?? "")}>

              <SelectTrigger className="bg-white/[0.07] border-white/[0.1] h-11 rounded-xl text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GCash">GCash</SelectItem>
                <SelectItem value="MariBank">MariBank</SelectItem>
                <SelectItem value="Maya">Maya</SelectItem>
                <SelectItem value="Unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          {/* Transaction type */}
          <FieldRow label="Transaction type">
            <Select value={txType} onValueChange={(v) => setTxType(v ?? "")}>

              <SelectTrigger className="bg-white/[0.07] border-white/[0.1] h-11 rounded-xl text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash In">Cash In</SelectItem>
                <SelectItem value="Cash Out">Cash Out</SelectItem>
                <SelectItem value="Telco Load">Telco Load</SelectItem>
                <SelectItem value="Bills Payment">Bills Payment</SelectItem>
                <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          {/* Amount + Earnings */}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Amount">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">₱</span>
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  readOnly={false}
                  className="bg-white/[0.07] border-white/[0.1] h-11 rounded-xl pl-7 tabular-nums text-sm"
                />
              </div>
            </FieldRow>
            <FieldRow label="Your earnings">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 text-sm pointer-events-none">₱</span>
                <Input
                  value={profit}
                  onChange={(e) => setProfit(e.target.value)}
                  readOnly={false}
                  className="bg-white/[0.07] border-white/[0.1] h-11 rounded-xl pl-7 text-emerald-400 font-semibold tabular-nums text-sm"
                />
              </div>
            </FieldRow>
          </div>

          {/* Customer number */}
          <FieldRow label="Customer number">
            <Input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              readOnly={false}
              placeholder="Not found"
              className="bg-white/[0.07] border-white/[0.1] h-11 rounded-xl text-sm tabular-nums"
            />
          </FieldRow>

          {/* Reference number */}
          <FieldRow label="Transaction number">
            <Input
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              readOnly={false}
              placeholder="Not found"
              className="bg-white/[0.07] border-white/[0.1] h-11 rounded-xl text-sm tabular-nums"
            />
          </FieldRow>

          {/* Date & Time */}
          <FieldRow label="Date & Time">
            <Input
              type="datetime-local"
              value={txDate}
              onChange={(e) => setTxDate(e.target.value)}
              className="bg-white/[0.07] border-white/[0.1] h-11 rounded-xl text-sm"
            />
          </FieldRow>
        </div>
      </section>

      {/* Action Button */}
      <div className="sticky bottom-0 px-5 pb-10 pt-4 bg-gradient-to-t from-background via-background/95 to-transparent">
        <button
          onClick={handleSave}
          disabled={saving || isPreview}
          className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl text-[15px] transition-colors"
        >
          {saving ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</>
          ) : (
            <><Check className="w-5 h-5" /> {isPreview ? "Save Transaction (preview)" : "Save Transaction"}</>
          )}
        </button>
      </div>
    </div>
  );
}
