"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useMemo, useRef } from "react";
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
import { parsePesosInput, toMinor } from "@core/money.ts";
import { isTransactionType } from "@core/types.ts";
import {
  formatPesos,
  loadEntryContext,
  previewEntry,
  type EntryContext,
} from "@/lib/ledger";

// Shown only if the operator's wallets could not be loaded, so the form is
// still usable. The server checks the platform against real accounts anyway.
const FALLBACK_PLATFORMS = ["GCash", "MariBank", "Maya"];

const ACCOUNT_LABEL: Record<string, string> = {
  cash: "Drawer cash",
  revenue: "Your earnings",
  equity: "Owner's equity",
};

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
  /**
   * One key per mounted confirmation, not per tap.
   *
   * crypto.randomUUID needs a secure context; Capacitor's webview and
   * localhost both qualify, but the fallback keeps this working if that ever
   * changes rather than throwing at the moment of saving money.
   */
  const idempotencyKey = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const [amountIncludesFee, setAmountIncludesFee] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [platform, setPlatform] = useState("");
  const [txType, setTxType] = useState("");
  const [amount, setAmount] = useState("");
  const [context, setContext] = useState<EntryContext | null>(null);
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

  // Wallets and fee rules, for the platform list and the fee preview. A
  // failure here is not fatal: the form falls back to the standard platforms
  // and shows no preview, and the server still prices and checks everything.
  useEffect(() => {
    if (isPreview) return;
    let cancelled = false;
    loadEntryContext()
      .then((ctx) => { if (!cancelled) setContext(ctx); })
      .catch(() => { /* fallback list, no preview */ });
    return () => { cancelled = true; };
  }, [isPreview]);

  // Only Cash Out can have the fee inside the printed amount; a stale answer
  // must not survive a change of type.
  useEffect(() => {
    if (txType !== "Cash Out") setAmountIncludesFee(false);
  }, [txType]);

  // Read exactly or not at all. parseFloat turned "1,850" into 1 here, and a
  // blank field into NaN, which the server replaced with the AI's figure.
  const amountMinor = useMemo(() => parsePesosInput(amount), [amount]);
  const amountValid = amountMinor !== null && amountMinor > 0;

  const preview = useMemo(() => {
    if (!context || !amountValid || platform === "" || !isTransactionType(txType)) return null;
    try {
      return previewEntry(
        {
          transactionType: txType,
          platform,
          amountPesos: (amountMinor as number) / 100,
          amountIncludesFee,
        },
        context.rules
      );
    } catch {
      // The ledger would refuse this (a Cash Out whose fee exceeds the
      // amount, for one). No preview; Save reports why.
      return null;
    }
  }, [context, amountValid, amountMinor, platform, txType, amountIncludesFee]);

  // What the receipt reader left blank, in the operator's words.
  const unread = [
    platform === "" ? "which app this was" : null,
    txType === "" ? "the transaction type" : null,
    tx && !(tx.amount > 0) && !amountValid ? "the amount" : null,
  ].filter((x): x is string => x !== null);

  const platformOptions = useMemo(() => {
    const list = context && context.platforms.length > 0 ? context.platforms : FALLBACK_PLATFORMS;
    return platform !== "" && !list.includes(platform) ? [...list, platform] : list;
  }, [context, platform]);

  function populate(data: TransactionDraft) {
    // NOT `?? "GCash"`. An unidentified platform must stay unidentified: a
    // pre-filled field on a mobile confirm screen is a field the operator taps
    // past, and a wrong platform costs twice the transaction amount across two
    // accounts while passing every ledger invariant. Absent is cheap and loud;
    // wrong is expensive and silent.
    setPlatform(data.platform === "Unknown" ? "" : (data.platform ?? ""));
    // The same rule for type and amount. An unread type used to arrive here as
    // "Cash In" and an unread amount as 0; both are now left empty so the
    // operator has to supply them, and Save stays disabled until they do.
    setTxType(isTransactionType(data.transaction_type) ? data.transaction_type : "");
    setAmount(data.amount > 0 ? data.amount.toString() : "");
    setAccountNumber(data.account_number ?? "");
    setReferenceNumber(data.reference_number ?? "");
    setTxDate(data.transaction_date ? data.transaction_date.slice(0, 16) : "");
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async function handleSave() {
    if (!tx || isPreview) return;
    if (amountMinor === null || amountMinor <= 0) {
      setSaveError("Enter the amount, for example 1850 or 1,850.50");
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/login"); return; }

      const edits: Record<string, unknown> = {};
      if (platform !== tx.platform) edits.platform = platform;
      if (txType !== tx.transaction_type) edits.transaction_type = txType;
      // Compared in centavos. The fee is not sent: the server prices the
      // transaction from the fee rules, and an earnings figure typed here was
      // silently dropped.
      if (amountMinor !== toMinor(tx.amount)) edits.amount = amountMinor / 100;
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
            // Required by the gate. Held in a ref so it is STABLE across
            // retries of this same confirmation: a double tap, or a Save that
            // errored after the entry was already posted, replays the same key
            // and post_entry returns the original entry instead of posting a
            // second one. Generating it inline would defeat the whole point.
            idempotency_key: idempotencyKey.current,
            // The operator's answer to the gross-amount question, when it was
            // asked. Never inferred — see gross_amount_hint below.
            amount_includes_fee: amountIncludesFee,
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
      {/* The banner tells the truth about what happened.
          It used to render the green "AI read your screenshot" success state
          unconditionally — including over a platform the model explicitly said
          it could not identify, styled identically to a confident read. */}
      <section className="px-5 mb-4">
        {unread.length > 0 ? (
          <div className="flex items-start gap-2.5 bg-amber-500/[0.10] border border-amber-500/20 rounded-2xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-amber-300">
                We couldn&apos;t read {unread.join(" or ")}
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Fill {unread.length === 1 ? "it" : "them"} in below from the receipt.
                Nothing is saved until you do.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 bg-emerald-500/8 border border-emerald-500/15 rounded-2xl px-4 py-3">
            <div className="w-7 h-7 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-emerald-400">AI read your screenshot</p>
              <p className="text-[11px] text-muted-foreground">{platform} · edit any field below if needed</p>
            </div>
          </div>
        )}
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
                {platformOptions.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
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

          {/* Amount */}
          <FieldRow label="Amount">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">₱</span>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={!amountValid}
                className="bg-white/[0.07] border-white/[0.1] h-11 rounded-xl pl-7 tabular-nums text-sm"
              />
            </div>
            {!amountValid && (
              <p className="text-[11px] text-red-400">
                {amountMinor === 0 || amount.trim() === ""
                  ? "Enter the amount on the receipt."
                  : "This isn't a readable amount. Use digits like 1850 or 1,850.50."}
              </p>
            )}

            {txType === "Cash Out" && (
              <button
                type="button"
                onClick={() => setAmountIncludesFee((v) => !v)}
                className="flex items-start gap-2.5 w-full text-left pt-1"
              >
                <span
                  className={`w-4 h-4 rounded flex-shrink-0 mt-0.5 flex items-center justify-center ${
                    amountIncludesFee ? "bg-emerald-500" : "bg-white/[0.12]"
                  }`}
                >
                  {amountIncludesFee && <Check className="w-3 h-3 text-black" />}
                </span>
                <span className="text-[11px] text-muted-foreground leading-relaxed">
                  This amount already includes my fee
                </span>
              </button>
            )}
          </FieldRow>

          {/* Fee and effect: computed, never typed. The same code prices it
              on the server when Save is tapped. */}
          {preview && (
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Your earnings</span>
                <span className="text-base font-semibold text-emerald-400 tabular-nums">
                  {formatPesos(preview.feePesos)}
                </span>
              </div>
              {!preview.rule && (
                <p className="text-[11px] text-amber-300 leading-relaxed">
                  No fee rule covers {txType} on {platform} yet, so this earns nothing.
                  Set one in <Link href="/settings/rules" className="underline">Settings → Fees</Link>.
                </p>
              )}
              <div className="h-px bg-white/[0.06]" />
              {preview.postings.map((p, i) => {
                const label =
                  p.account.kind === "platform"
                    ? p.account.platform
                    : ACCOUNT_LABEL[p.account.kind] ?? p.account.kind;
                const pesos = p.amount / 100;
                return (
                  <div key={i} className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`tabular-nums font-medium ${pesos > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {pesos > 0 ? "+" : "−"}{formatPesos(Math.abs(pesos))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

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
          disabled={saving || isPreview || platform === "" || txType === "" || !amountValid}
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
