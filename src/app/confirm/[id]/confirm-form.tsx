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
  Trash2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase/client";
import { formatAmountInput, typeName } from "@/lib/display";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { CashOutFeeChoice } from "@/components/cash-out-fee-choice";
import { parsePesosInput, toMinor } from "@core/money.ts";
import { CASH_ACCOUNT_NAME, isTransactionType } from "@core/types.ts";
import {
  formatPesos,
  loadEntryContext,
  newIdempotencyKey,
  previewEntry,
  voidTransaction,
  type EntryContext,
} from "@/lib/ledger";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Sheet } from "@/components/sheet";
import { summaryLine } from "@/components/entry-effects";
import { receiptUrl } from "@/lib/ledger";

// Shown only if the operator's wallets could not be loaded, so the form is
// still usable. The server checks the platform against real accounts anyway.
const FALLBACK_PLATFORMS = ["GCash", "MariBank", "Maya"];


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
  /** Wallet Transfer only. */
  transfer_to: string | null;
  platform_fee: number;
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
  transfer_to: null,
  platform_fee: 0,
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
      <label className="label">
        {label}
      </label>
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
  const [discarding, setDiscarding] = useState(false);
  // Discard cannot be undone and sits just under Save, so it asks first.
  const [askDiscard, setAskDiscard] = useState(false);
  const keyboardInset = useKeyboardInset();
  const discardKey = useRef<string>(newIdempotencyKey("discard"));
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [platform, setPlatform] = useState("");
  const [txType, setTxType] = useState("");
  const [amount, setAmount] = useState("");
  const [context, setContext] = useState<EntryContext | null>(null);
  // Wallet Transfer only.
  const [transferTo, setTransferTo] = useState("");
  const [platformFee, setPlatformFee] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [txDate, setTxDate] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  useEffect(() => {
    if (isPreview) return;
    let cancelled = false;
    receiptUrl(transactionId).then((url) => { if (!cancelled) setReceipt(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [transactionId, isPreview]);

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
          "id, platform, transaction_type, amount, net_profit, account_number, reference_number, transaction_date, status, transfer_to, platform_fee"
        )
        .eq("id", transactionId)
        .single();

      if (error || !data) {
        setFetchError("Transaction not found");
        setLoading(false);
        return;
      }
      const draft = data as TransactionDraft;
      // This form only confirms drafts. Anything already saved or voided has
      // its own screen; opening it here could only end in a refusal.
      if (draft.status !== "awaiting_confirm") {
        router.replace(`/transactions?id=${draft.id}`);
        return;
      }
      setTx(draft);
      populate(draft);
      setLoading(false);
    }
    load();
  }, [transactionId, isPreview, router]);

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

  // The drawer can only be an end of a transfer. If the type changes away
  // from one, a "Cash" source would be posted against as if it were a wallet.
  useEffect(() => {
    if (txType !== "Wallet Transfer") {
      setPlatform((p) => (p === CASH_ACCOUNT_NAME ? "" : p));
    }
  }, [txType]);

  // Only Cash Out can have the fee inside the printed amount; a stale answer
  // must not survive a change of type.
  useEffect(() => {
    if (txType !== "Cash Out") setAmountIncludesFee(false);
  }, [txType]);

  // Read exactly or not at all. parseFloat turned "1,850" into 1 here, and a
  // blank field into NaN, which the server replaced with the AI's figure.
  const amountMinor = useMemo(() => parsePesosInput(amount), [amount]);
  const amountValid = amountMinor !== null && amountMinor > 0;

  // A transfer is the shop moving its own money: two ends, either of which
  // may be the drawer, and possibly a fee charged by the app that moved it.
  const isTransfer = txType === "Wallet Transfer";
  const platformFeeMinor = useMemo(
    () => (platformFee.trim() === "" ? 0 : parsePesosInput(platformFee)),
    [platformFee],
  );
  const transferReady = !isTransfer
    || (transferTo !== "" && transferTo !== platform && platformFeeMinor !== null);

  // What still stands between the operator and Save, in order.
  const missing =
    txType === "" ? "Choose the transaction type"
    : platform === "" ? (isTransfer ? "Choose where the money came from" : "Choose which app this was")
    : isTransfer && transferTo === "" ? "Choose where the money went"
    : !amountValid ? "Enter the amount"
    : !transferReady ? "Fix the app's fee"
    : null;

  const preview = useMemo(() => {
    if (!context || !amountValid || platform === "" || !isTransactionType(txType)) return null;
    try {
      return previewEntry(
        {
          transactionType: txType,
          platform,
          amountPesos: (amountMinor as number) / 100,
          amountIncludesFee,
          transferTo: isTransfer ? transferTo : null,
          platformFeePesos: isTransfer && platformFeeMinor !== null ? platformFeeMinor / 100 : 0,
        },
        context.rules
      );
    } catch {
      // The ledger would refuse this (a Cash Out whose fee exceeds the
      // amount, for one). No preview; Save reports why.
      return null;
    }
  }, [context, amountValid, amountMinor, platform, txType, amountIncludesFee,
      isTransfer, transferTo, platformFeeMinor]);

  // What the receipt reader left blank, in the operator's words.
  const unread = [
    platform === "" ? "which app this was" : null,
    txType === "" ? "the transaction type" : null,
    tx && !(tx.amount > 0) && !amountValid ? "the amount" : null,
  ].filter((x): x is string => x !== null);

  const platformOptions = useMemo(() => {
    const wallets = context && context.platforms.length > 0 ? context.platforms : FALLBACK_PLATFORMS;
    // The drawer is a valid end of a transfer, and of nothing else.
    const list = isTransfer ? [...wallets, CASH_ACCOUNT_NAME] : wallets;
    return platform !== "" && !list.includes(platform) ? [...list, platform] : list;
  }, [context, platform, isTransfer]);

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
    setAmount(data.amount > 0 ? formatAmountInput(data.amount.toString()) : "");
    setTransferTo(data.transfer_to ?? "");
    setPlatformFee(data.platform_fee > 0 ? data.platform_fee.toString() : "");
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
      if (isTransfer) {
        if (transferTo !== (tx.transfer_to ?? "")) edits.transfer_to = transferTo;
        const feePesos = (platformFeeMinor ?? 0) / 100;
        if (feePesos !== Number(tx.platform_fee ?? 0)) edits.platform_fee = feePesos;
      }
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
      // 409 "confirmed" means it is already saved: an earlier tap got through
      // and only the reply was lost, or it was confirmed on another device.
      // Either way it is in the ledger, and reporting a failure would invite
      // the operator to record it a second time.
      const alreadySaved = response.status === 409 && data.status === "confirmed";
      if (!response.ok && !alreadySaved) throw new Error(data.error || "Failed to save");
      // Home shows "Saved · Undo" for this one.
      router.push(`/?saved=${tx.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  // Discard a draft that should not be recorded: a screenshot shared by
  // mistake, or one read so badly it is quicker to type. Nothing was posted
  // for a draft, so this only marks it voided.
  async function handleDiscard() {
    if (!tx || isPreview || saving || discarding) return;
    setDiscarding(true);
    setSaveError(null);
    try {
      await voidTransaction({ transactionId: tx.id, idempotencyKey: discardKey.current });
      router.push("/");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not discard the draft");
      setDiscarding(false);
    }
  }

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <AppShell>
        <div className="flex-1 grid place-items-center">
          <Loader2 className="late w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (fetchError) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center max-w-[430px] mx-auto px-5">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-[15px] text-destructive">{fetchError}</p>
          <Link href="/" className="text-[15px] text-primary block">Go home</Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  const walletName = (p: string) => (p === CASH_ACCOUNT_NAME ? "Cash drawer" : p);
  const control = "bg-transparent text-right text-[15px] font-medium outline-none min-w-0 flex-1 placeholder:text-primary placeholder:font-semibold";
  const row = "flex items-center justify-between gap-4 min-h-[52px] border-b border-border";
  const label = (text: string, flag: boolean) => (
    <span className={`text-[15px] flex items-center gap-2 flex-shrink-0 ${flag ? "text-foreground" : "text-muted-foreground"}`}>
      {flag && <span className="w-2 h-2 rounded-full bg-primary" />}
      {text}
    </span>
  );

  return (
    <AppShell>
      <PageHeader
        title="Review"
        back="/"
        action={
          <button type="button" onClick={() => setAskDiscard(true)} className="h-11 -mr-1 text-[15px] text-muted-foreground justify-self-end">
            Discard
          </button>
        }
      />

      <section className="px-6 flex-1 pb-6 lg:max-w-md lg:mx-auto lg:w-full">
        <div className="flex items-center gap-3.5 mb-3">
          {receipt ? (
            <button type="button" onClick={() => setShowReceipt(true)} aria-label="View receipt" className="w-[54px] h-[76px] rounded-[10px] overflow-hidden bg-muted flex-shrink-0">
              <img src={receipt} alt="" className="w-full h-full object-cover object-top" />
            </button>
          ) : (
            <div className="w-[54px] h-[76px] rounded-[10px] bg-muted flex-shrink-0 p-2.5 flex flex-col gap-1.5" aria-hidden>
              <span className="h-1 rounded bg-input" /><span className="h-1 rounded bg-input" /><span className="h-2 w-3/5 rounded bg-muted-foreground" /><span className="h-1 rounded bg-input" />
            </div>
          )}
          <div className="text-[13px] text-muted-foreground">
            <p>{unread.length > 0 ? `Couldn't read ${unread.join(" or ")}.` : "Read from your screenshot."}</p>
            {receipt && (
              <button type="button" onClick={() => setShowReceipt(true)} className="text-foreground font-medium underline underline-offset-4 h-8">
                View receipt
              </button>
            )}
          </div>
        </div>

        <div>
          <div className={row}>
            {label("Type", txType === "")}
            <select aria-label="Type" value={txType} onChange={(e) => setTxType(e.target.value)} className={control}>
              <option value="">Choose</option>
              {["Cash In", "Cash Out", "Telco Load", "Bills Payment", "Bank Transfer", "Wallet Transfer"].map((t) => (
                <option key={t} value={t}>{typeName(t)}</option>
              ))}
            </select>
          </div>
          <div className={row}>
            {label(isTransfer ? "From" : "Wallet", platform === "")}
            <select aria-label={isTransfer ? "From" : "Wallet"} value={platform} onChange={(e) => setPlatform(e.target.value)} className={control}>
              <option value="">Choose</option>
              {platformOptions.map((p) => <option key={p} value={p}>{walletName(p)}</option>)}
            </select>
          </div>
          {isTransfer && (
            <div className={row}>
              {label("To", transferTo === "")}
              <select aria-label="To" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className={control}>
                <option value="">Choose</option>
                {platformOptions.filter((p) => p !== platform).map((p) => <option key={p} value={p}>{walletName(p)}</option>)}
              </select>
            </div>
          )}
          <div className={row}>
            {label("Amount", !amountValid)}
            <span className="flex items-center justify-end flex-1 min-w-0">
              <span className="text-muted-foreground mr-0.5">₱</span>
              <input
                aria-label="Amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="Add"
                value={amount}
                onChange={(e) => setAmount(formatAmountInput(e.target.value))}
                className="amount bg-transparent text-right text-[17px] font-semibold outline-none placeholder:text-primary"
                style={{ width: `${Math.max(3, amount.length) * 0.66}em` }}
              />
            </span>
          </div>
          {isTransfer && (
            <div className={row}>
              {label("App's fee", platformFeeMinor === null)}
              <input aria-label="App's fee" inputMode="decimal" autoComplete="off" placeholder="None" value={platformFee} onChange={(e) => setPlatformFee(e.target.value)} className={`${control} tabular-nums placeholder:!text-muted-foreground placeholder:!font-medium`} />
            </div>
          )}
          {!isTransfer && (
            <div className={row}>
              {label("Customer no.", false)}
              <input aria-label="Customer number" inputMode="numeric" autoComplete="off" placeholder="Add" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className={`${control} tabular-nums`} />
            </div>
          )}
          <div className={row}>
            {label("Reference", referenceNumber === "")}
            <input aria-label="Reference number" autoComplete="off" placeholder="Add" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} className={`${control} tabular-nums`} />
          </div>
          <div className={row}>
            {label("Date", false)}
            <input aria-label="Date and time" type="datetime-local" value={txDate} onChange={(e) => setTxDate(e.target.value)} className={`${control} tabular-nums`} />
          </div>
        </div>

        <p className="mt-4 text-[15px] font-medium min-h-6" aria-live="polite">
          {preview ? summaryLine(preview.postings) : null}
        </p>

        {preview && !preview.rule && !isTransfer && (
          <p className="mt-1 text-[13px] text-warning">
            No fee is set for this yet, so it earns nothing.{" "}
            <Link href="/settings/rules" className="underline underline-offset-4">Set one</Link>
          </p>
        )}

        {txType === "Cash Out" && (
          <div className="w-fit -ml-1 mt-1">
            <CashOutFeeChoice value={amountIncludesFee} onChange={setAmountIncludesFee} />
          </div>
        )}

        {saveError && (
          <div className="mt-3 rounded-2xl bg-destructive/10 p-3 flex gap-2.5">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-[15px] text-destructive">{saveError}</p>
          </div>
        )}
      </section>

      <div
        className="sticky bottom-0 mt-auto px-6 pt-3 bg-background lg:max-w-md lg:mx-auto lg:w-full"
        style={{
          bottom: keyboardInset,
          paddingBottom: keyboardInset > 0 ? 12 : "max(1.5rem, env(safe-area-inset-bottom))",
        }}
      >
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || discarding || missing !== null || isPreview}
          className="btn btn-primary w-full disabled:!opacity-100 disabled:!bg-muted disabled:!text-muted-foreground"
        >
          {saving ? (<><Loader2 className="w-4 h-4 animate-spin" />Saving…</>) : missing ?? "Save"}
        </button>
      </div>

      <Sheet open={askDiscard} onClose={() => setAskDiscard(false)} title="Discard this draft?">
        <p className="text-[15px] text-muted-foreground mt-2 mb-5">It was never counted, so no balance changes.</p>
        <div className="space-y-2.5">
          <button type="button" onClick={handleDiscard} disabled={discarding} className="btn btn-danger w-full">
            {discarding ? "Discarding…" : "Discard"}
          </button>
          <button type="button" onClick={() => setAskDiscard(false)} className="btn btn-secondary w-full">
            Keep it
          </button>
        </div>
      </Sheet>

      <Sheet open={showReceipt} onClose={() => setShowReceipt(false)} title="Receipt">
        {receipt && <img src={receipt} alt="The receipt screenshot" className="mt-3 w-full max-h-[70dvh] object-contain rounded-2xl bg-muted" />}
      </Sheet>
    </AppShell>
  );
}
