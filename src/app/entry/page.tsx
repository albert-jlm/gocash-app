"use client";

/**
 * Entry — record a transaction by typing it.
 *
 * WHY THIS SCREEN EXISTS
 * Until now the only way into the ledger was /capture: photograph a receipt and
 * let GPT-4o read it. That made a vision model load-bearing for a shop counter.
 * Five of the fields on this form are things the operator already knows before
 * any receipt appears on screen — they chose the type, they know which wallet,
 * they were handed the cash — so reading them back off an image is slower than
 * typing them and can be wrong in ways typing cannot.
 *
 * WHY THE PREVIEW IS LIVE
 * The fee and the balance effect update as the amount is typed, computed by the
 * same `calculateFee` and `buildPostings` the server runs at the gate. For a
 * typed transaction the form IS the review step: adding a second confirmation
 * screen for figures entered three seconds ago is friction that teaches
 * operators to tap through without looking, which is the failure mode the gate
 * exists to prevent. The screenshot path keeps its separate review screen,
 * because there the numbers came from a model rather than a person.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, Loader2, AlertCircle } from "lucide-react";
import { CASH_ACCOUNT_NAME, TRANSACTION_TYPES, type TransactionType } from "@core/types.ts";
import { parsePesosInput } from "@core/money.ts";
import {
  createAndConfirmTransaction,
  loadEntryContext,
  previewEntry,
  type EntryContext,
} from "@/lib/ledger";
import { AppShell } from "@/components/app-shell";
import { summaryLine } from "@/components/entry-effects";
import { AmountKeypad } from "@/components/amount-keypad";
import { formatAmountInput, typeName } from "@/lib/display";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { CashOutFeeChoice } from "@/components/cash-out-fee-choice";




export default function EntryPage() {
  const router = useRouter();

  // Stable across every retry of ONE Save. Generating this inside the submit
  // handler would defeat its entire purpose: a double tap, or a Save whose
  // response was lost after the entry posted, must replay the SAME key so the
  // server returns the original entry instead of posting a second one.
  const idempotencyKey = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const [context, setContext] = useState<EntryContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // No type is selected to begin with. "Cash In" used to be pre-selected, and
  // a forgotten tap then recorded a Cash Out as a Cash In: wallet and drawer
  // both moved the wrong way, in a perfectly balanced entry. The Home tiles
  // open this form with the type already chosen (?type=Cash%20Out).
  const [txType, setTxType] = useState<TransactionType | "">("");
  const keyboardInset = useKeyboardInset();

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("type");
    if (wanted && (TRANSACTION_TYPES as readonly string[]).includes(wanted)) {
      setTxType(wanted as TransactionType);
    } else {
      router.replace("/new");
    }
  }, [router]);
  const [platform, setPlatform] = useState("");
  const [amount, setAmount] = useState("");
  const [amountIncludesFee, setAmountIncludesFee] = useState(false);
  const [reference, setReference] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  // Wallet Transfer only.
  const [transferTo, setTransferTo] = useState("");
  const [platformFee, setPlatformFee] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const needsPlatform = txType !== "Profit Remittance";
  const isTransfer = txType === "Wallet Transfer";
  // A transfer may start or end at the drawer as well as at a wallet.
  const sources = isTransfer ? [...(context?.platforms ?? []), CASH_ACCOUNT_NAME] : context?.platforms ?? [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await loadEntryContext();
        if (cancelled) return;
        setContext(ctx);
        // Pre-select only when there is no ambiguity. With two or more wallets
        // the operator picks: defaulting to the first would silently attribute
        // the transaction to whichever account happened to sort first, which is
        // the `?? "GCash"` fallback this rebuild removed.
        if (ctx.platforms.length === 1) setPlatform(ctx.platforms[0]);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Could not load your wallets");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Only Cash Out can have the fee baked into the printed amount, so the
  // question is meaningless elsewhere and the answer must not survive a type
  // change — a stale `true` would under-charge every subsequent entry.
  useEffect(() => {
    if (txType !== "Cash Out") setAmountIncludesFee(false);
    // The drawer is only a valid "wallet" on a transfer, and a destination or
    // platform fee means nothing on anything else.
    if (txType !== "Wallet Transfer") {
      setTransferTo("");
      setPlatformFee("");
      setPlatform((p) => (p === CASH_ACCOUNT_NAME ? "" : p));
    }
  }, [txType]);

  // Blank means no fee. Anything else has to read exactly.
  const platformFeeMinor = useMemo(
    () => (platformFee.trim() === "" ? 0 : parsePesosInput(platformFee)),
    [platformFee],
  );

  const amountPesos = useMemo(() => {
    // Exact, and null for anything that is not unambiguously an amount:
    // parseFloat read "1,850" as 1.
    const minor = parsePesosInput(amount);
    return minor !== null && minor > 0 ? minor / 100 : 0;
  }, [amount]);

  const preview = useMemo(() => {
    if (!context || amountPesos <= 0 || txType === "") return null;
    if (needsPlatform && !platform) return null;
    try {
      return previewEntry(
        {
          transactionType: txType, platform, amountPesos, amountIncludesFee,
          transferTo: isTransfer ? transferTo : null,
          platformFeePesos: isTransfer && platformFeeMinor !== null ? platformFeeMinor / 100 : 0,
        },
        context.rules
      );
    } catch {
      // buildPostings rejects inputs the ledger would refuse — a Cash Out whose
      // fee exceeds the amount, for one. Showing no preview is the honest
      // answer; Save will report why.
      return null;
    }
  }, [context, amountPesos, needsPlatform, platform, txType, amountIncludesFee,
      isTransfer, transferTo, platformFeeMinor]);

  // What still stands between the operator and Save, in order. A greyed-out
  // button that does not say why leaves them guessing.
  const missing =
    txType === "" ? "Choose what happened"
    : needsPlatform && platform === "" ? (isTransfer ? "Choose where the money came from" : "Choose the wallet")
    : isTransfer && transferTo === "" ? "Choose where the money went"
    : amountPesos <= 0 ? "Enter the amount"
    : isTransfer && platformFeeMinor === null ? "Fix the app's fee"
    : preview === null ? "This can't be recorded as entered"
    : null;

  const canSave = !saving && missing === null && txType !== "";

  async function handleSave() {
    if (!canSave || !txType) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await createAndConfirmTransaction({
        transactionType: txType,
        platform,
        amountPesos,
        referenceNumber: reference.trim() || null,
        accountNumber: accountNumber.trim() || null,
        amountIncludesFee,
        transferTo: isTransfer ? transferTo : null,
        platformFeePesos: isTransfer && platformFeeMinor !== null ? platformFeeMinor / 100 : 0,
        idempotencyKey: idempotencyKey.current,
      });
      // Home shows "Saved · Undo" for this one.
      router.push(`/?saved=${saved.transactionId}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const walletLabel = (p: string) => (p === CASH_ACCOUNT_NAME ? "Cash drawer" : p);
  const pill = (on: boolean) =>
    `h-11 px-4 rounded-full text-[15px] font-medium flex-shrink-0 transition-colors ${
      on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
    }`;
  const summary = preview ? summaryLine(preview.postings, { feeInside: amountIncludesFee }) : null;

  return (
    <AppShell active="new">
      <header className="px-6 pt-[calc(env(safe-area-inset-top)+1.25rem)] lg:pt-10 pb-4 grid grid-cols-[44px_1fr_44px] items-center">
        <Link href="/new" aria-label="Back" className="w-11 h-11 -ml-2.5 grid place-items-center">
          <ChevronLeft className="w-[22px] h-[22px]" />
        </Link>
        <h1 className="text-[17px] font-semibold text-center">{txType === "" ? "New transaction" : typeName(txType)}</h1>
      </header>

      {loadError && (
        <div className="mx-6 mb-4 rounded-2xl bg-destructive/10 p-3 flex gap-2.5">
          <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-[15px] text-destructive">{loadError}</p>
        </div>
      )}

      {context && context.platforms.length === 0 && (
        <div className="mx-6 mb-4 rounded-2xl bg-muted p-3 flex gap-2.5">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="text-[15px]">
            No wallets set up yet. Add one in{" "}
            <Link href="/settings/platforms" className="underline underline-offset-4">Settings → Platforms</Link>.
          </p>
        </div>
      )}

      {txType !== "" && (
        <section className="px-6 flex-1 pb-6 lg:max-w-md lg:mx-auto lg:w-full">
          {needsPlatform && (
            <div>
              {isTransfer && <p className="text-[13px] text-muted-foreground mb-2">From</p>}
              <div
                role="radiogroup"
                aria-label={isTransfer ? "From" : "Wallet"}
                className="overflow-x-auto -mx-6 px-6"
                style={{ scrollbarWidth: "none" }}
              >
                <div className={`flex gap-2 w-max ${isTransfer ? "" : "mx-auto"}`}>
                  {sources.map((p) => (
                    <button key={p} type="button" role="radio" aria-checked={platform === p} onClick={() => setPlatform(p)} className={pill(platform === p)}>
                      {walletLabel(p)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {isTransfer && (
            <div className="mt-4">
              <p className="text-[13px] text-muted-foreground mb-2">To</p>
              <div role="radiogroup" aria-label="To" className="flex gap-2 overflow-x-auto -mx-6 px-6" style={{ scrollbarWidth: "none" }}>
                {sources.filter((p) => p !== platform).map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={transferTo === p} onClick={() => setTransferTo(p)} className={pill(transferTo === p)}>
                    {walletLabel(p)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label htmlFor="amount" className="sr-only">Amount</label>
          <div className="amount mt-7 flex items-start justify-center font-semibold leading-none">
            <span className="text-[28px] font-medium text-muted-foreground mt-1.5 mr-1">₱</span>
            <input
              id="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(formatAmountInput(e.target.value))}
              size={Math.max(1, amount.length)}
              className="amount bg-transparent text-[58px] font-semibold tracking-tight text-center outline-none placeholder:text-input max-w-full"
              style={{ width: `${Math.max(1, amount.length) * 0.62}em` }}
            />
          </div>

          <p className="mt-3 text-[15px] text-center font-medium min-h-6" aria-live="polite">
            {summary ?? (isTransfer ? <span className="text-muted-foreground font-normal">The amount that arrived</span> : null)}
          </p>

          {preview && !preview.rule && !isTransfer && (
            <p className="mt-2 text-[15px] text-center text-warning">
              No fee is set for this yet, so it earns nothing.{" "}
              <Link href="/settings/rules" className="underline underline-offset-4">Set one</Link>
            </p>
          )}

          {txType === "Cash Out" && context && (
            <div className="mt-3">
              <CashOutFeeChoice
                amountPesos={amountPesos}
                platform={platform}
                rules={context.rules}
                value={amountIncludesFee}
                onChange={setAmountIncludesFee}
              />
            </div>
          )}

          <AmountKeypad value={amount} onChange={setAmount} className="mt-6 lg:hidden" />

          {isTransfer && (
            <div className="mt-6">
              <label htmlFor="platform-fee" className="text-[13px] text-muted-foreground">
                Fee the app charged you, if any
              </label>
              <div className="relative mt-2">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">₱</span>
                <input
                  id="platform-fee"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={platformFee}
                  onChange={(e) => setPlatformFee(e.target.value)}
                  className="w-full h-12 rounded-2xl bg-muted pl-9 pr-4 text-base tabular-nums"
                />
              </div>
              {platformFeeMinor === null && (
                <p className="text-[15px] text-destructive mt-1.5">Use digits like 15 or 15.00.</p>
              )}
            </div>
          )}

          <div className="mt-5">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
              className="flex items-center gap-1.5 text-[15px] text-muted-foreground h-11 mx-auto"
            >
              Reference and customer number
              <ChevronDown className={`w-4 h-4 transition-transform ${showDetails ? "rotate-180" : ""}`} />
            </button>

            {showDetails && (
              <div className="space-y-3 pt-1">
                <div>
                  <label htmlFor="reference" className="text-[13px] text-muted-foreground">Reference number</label>
                  <input
                    id="reference"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="w-full h-12 mt-1.5 rounded-2xl bg-muted px-4 text-base tabular-nums"
                  />
                </div>
                <div>
                  <label htmlFor="account" className="text-[13px] text-muted-foreground">Customer number</label>
                  <input
                    id="account"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    className="w-full h-12 mt-1.5 rounded-2xl bg-muted px-4 text-base tabular-nums"
                  />
                </div>
              </div>
            )}
          </div>

          {saveError && (
            <div className="mt-3 rounded-2xl bg-destructive/10 p-3 flex gap-2.5">
              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-[15px] text-destructive">{saveError}</p>
            </div>
          )}
        </section>
      )}

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
          disabled={!canSave}
          className="btn btn-primary w-full"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving…
            </>
          ) : missing ? (
            missing
          ) : (
            "Save"
          )}
        </button>
      </div>
    </AppShell>
  );
}
