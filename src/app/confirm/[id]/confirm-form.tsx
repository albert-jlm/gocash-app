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
import { EntryEffects } from "@/components/entry-effects";
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
      <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
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
      <div className="flex min-h-screen bg-background items-center justify-center max-w-[430px] mx-auto">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Loading transaction…</p>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center max-w-[430px] mx-auto px-5">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm text-destructive">{fetchError}</p>
          <Link href="/" className="text-sm text-primary block">Go home</Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <AppShell>
      {/* Header */}
      <header className="px-5 pt-[calc(env(safe-area-inset-top)+1.25rem)] lg:pt-10 pb-4 flex items-center gap-3">
        <Link
          href="/"
          className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0"
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
          <div className="flex items-start gap-2.5 bg-warning/[0.10] border border-warning/20 rounded-2xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-warning">
                We couldn&apos;t read {unread.join(" or ")}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Fill {unread.length === 1 ? "it" : "them"} in below from the receipt.
                Nothing is saved until you do.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 bg-primary/8 border border-primary/15 rounded-2xl px-4 py-3">
            <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-primary">AI read your screenshot</p>
              <p className="text-xs text-muted-foreground">{platform} · edit any field below if needed</p>
            </div>
          </div>
        )}
      </section>

      {/* Form */}
      <section className="px-5 flex-1">
        {saveError && (
          <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2.5 mb-4">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">{saveError}</p>
          </div>
        )}

        <div className="rounded-2xl p-4 space-y-4 mb-4 bg-muted border border-border">
          {/* Platform */}
          <FieldRow label={isTransfer ? "From" : "App used"}>
            <Select value={platform} onValueChange={(v) => setPlatform(v ?? "")}>

              <SelectTrigger className="bg-muted border-border h-11 w-full rounded-xl text-sm">
                <SelectValue placeholder="Choose the app" />
              </SelectTrigger>
              <SelectContent>
                {platformOptions.map((p) => (
                  <SelectItem key={p} value={p}>{p === CASH_ACCOUNT_NAME ? "Cash drawer" : p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>

          {/* Transaction type */}
          <FieldRow label="Transaction type">
            <Select value={txType} onValueChange={(v) => setTxType(v ?? "")}>

              <SelectTrigger className="bg-muted border-border h-11 w-full rounded-xl text-sm">
                <SelectValue placeholder="Choose the type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash In">{typeName("Cash In")}</SelectItem>
                <SelectItem value="Cash Out">{typeName("Cash Out")}</SelectItem>
                <SelectItem value="Telco Load">{typeName("Telco Load")}</SelectItem>
                <SelectItem value="Bills Payment">{typeName("Bills Payment")}</SelectItem>
                <SelectItem value="Bank Transfer">{typeName("Bank Transfer")}</SelectItem>
                <SelectItem value="Wallet Transfer">{typeName("Wallet Transfer")}</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          {/* Destination: transfers only */}
          {isTransfer && (
            <FieldRow label="To">
              <Select value={transferTo} onValueChange={(v) => setTransferTo(v ?? "")}>
                <SelectTrigger className="bg-muted border-border h-11 w-full rounded-xl text-sm">
                  <SelectValue placeholder="Choose where it went" />
                </SelectTrigger>
                <SelectContent>
                  {platformOptions.filter((p) => p !== platform).map((p) => (
                    <SelectItem key={p} value={p}>{p === CASH_ACCOUNT_NAME ? "Cash drawer" : p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your own money moving between your wallets or the drawer. No fee is earned.
              </p>
            </FieldRow>
          )}

          {/* Amount */}
          <FieldRow label={isTransfer ? "Amount that arrived" : "Amount"}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">₱</span>
              <Input
                value={amount}
                onChange={(e) => setAmount(formatAmountInput(e.target.value))}
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={!amountValid}
                className="bg-muted border-border h-14 rounded-xl pl-8 tabular-nums text-2xl font-semibold"
              />
            </div>
            {!amountValid && (
              <p className="text-xs text-destructive">
                {amountMinor === 0 || amount.trim() === ""
                  ? "Enter the amount on the receipt."
                  : "This isn't a readable amount. Use digits like 1850 or 1,850.50."}
              </p>
            )}

            {txType === "Cash Out" && context && amountValid && (
              <CashOutFeeChoice
                amountPesos={(amountMinor as number) / 100}
                platform={platform}
                rules={context.rules}
                value={amountIncludesFee}
                onChange={setAmountIncludesFee}
              />
            )}
          </FieldRow>

          {isTransfer && (
            <FieldRow label="Fee the app charged you (if any)">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">₱</span>
                <Input
                  value={platformFee}
                  onChange={(e) => setPlatformFee(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  aria-invalid={platformFeeMinor === null}
                  className="bg-muted border-border h-11 rounded-xl pl-7 tabular-nums text-sm"
                />
              </div>
              {platformFeeMinor === null && (
                <p className="text-xs text-destructive">This isn&apos;t a readable amount. Use digits like 15 or 15.00.</p>
              )}
            </FieldRow>
          )}

          {/* Fee and effect: computed, never typed. The same code prices it
              on the server when Save is tapped. */}
          {preview && (
            <div className="rounded-xl bg-muted/60 border border-border p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                What saving this does
              </p>
              {isTransfer && (
                <p className="text-xs text-muted-foreground">Your own money, moved. Nothing is earned on this.</p>
              )}
              {!preview.rule && !isTransfer && (
                <p className="text-xs text-warning leading-relaxed">
                  No fee rule covers {txType} on {platform} yet, so this earns nothing.
                  Set one in <Link href="/settings/rules" className="underline">Settings → Fees</Link>.
                </p>
              )}
              <div className="h-px bg-muted" />
              <EntryEffects postings={preview.postings} dense />
            </div>
          )}

          {/* Customer number */}
          <FieldRow label="Customer number">
            <Input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              readOnly={false}
              placeholder="Not found"
              className="bg-muted border-border h-11 rounded-xl text-sm tabular-nums"
            />
          </FieldRow>

          {/* Reference number */}
          <FieldRow label="Transaction number">
            <Input
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              readOnly={false}
              placeholder="Not found"
              className="bg-muted border-border h-11 rounded-xl text-sm tabular-nums"
            />
          </FieldRow>

          {/* Date & Time */}
          <FieldRow label="Date & Time">
            <Input
              type="datetime-local"
              value={txDate}
              onChange={(e) => setTxDate(e.target.value)}
              className="bg-muted border-border h-11 rounded-xl text-sm"
            />
          </FieldRow>
        </div>
      </section>

      {/* Action Button */}
      <div
        className="sticky bottom-0 px-5 pt-3 bg-background border-t border-border"
        style={{
          bottom: keyboardInset,
          paddingBottom: keyboardInset > 0 ? 12 : "max(1.5rem, env(safe-area-inset-bottom))",
        }}
      >
        <button
          onClick={handleSave}
          disabled={saving || discarding || isPreview || platform === "" || txType === "" || !amountValid || !transferReady}
          className="w-full flex items-center justify-center gap-2 bg-primary active:bg-primary/80 text-primary-foreground font-semibold py-4 rounded-2xl text-base transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
        >
          {saving ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</>
          ) : (
            missing && !isPreview
              ? <>{missing}</>
              : <><Check className="w-5 h-5" /> {isPreview ? "Save Transaction (preview)" : "Save Transaction"}</>
          )}
        </button>
        {!isPreview && !askDiscard && (
          <button
            type="button"
            onClick={() => setAskDiscard(true)}
            disabled={saving || discarding}
            className="mt-2.5 w-full flex items-center justify-center gap-2 rounded-2xl border border-destructive/25 bg-destructive/[0.08] text-destructive font-medium py-3.5 text-sm active:bg-destructive/[0.15] disabled:opacity-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Discard this draft
          </button>
        )}
        {!isPreview && askDiscard && (
          <div className="mt-2.5 rounded-2xl border border-destructive/25 bg-destructive/[0.08] p-3 space-y-2.5">
            <p className="text-sm text-center">Discard this draft? It can&apos;t be brought back.</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAskDiscard(false)}
                disabled={discarding}
                className="rounded-xl bg-muted font-medium py-3 text-sm disabled:opacity-50"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={handleDiscard}
                disabled={discarding}
                className="rounded-xl bg-destructive text-white font-semibold py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {discarding ? <><Loader2 className="w-4 h-4 animate-spin" /> Discarding…</> : "Yes, discard"}
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
