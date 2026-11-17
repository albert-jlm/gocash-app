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
import {
  ArrowLeft, Check, ChevronDown, Loader2, AlertCircle, Camera,
} from "lucide-react";
import { TRANSACTION_TYPES, type TransactionType } from "@core/types.ts";
import { parsePesosInput } from "@core/money.ts";
import {
  createAndConfirmTransaction,
  loadEntryContext,
  previewEntry,
  formatPesos,
  type EntryContext,
} from "@/lib/ledger";

/** Shorter labels than the enum values; the counter has no room for "Profit Remittance". */
const TYPE_LABEL: Record<TransactionType, string> = {
  "Cash In": "Cash In",
  "Cash Out": "Cash Out",
  "Telco Load": "Load",
  "Bills Payment": "Bills",
  "Bank Transfer": "Transfer",
  "Profit Remittance": "Remit",
};

/**
 * What the operator is doing, in their words, so the direction is unambiguous
 * on screen rather than only in the posting code. The four contradictory
 * definitions of "Cash In" across the PRD, the spec and the old settings UI are
 * what made four of six transaction types destroy money, and the fix is not
 * only correct code — it is saying which way round it is where it is used.
 */
const TYPE_HINT: Record<TransactionType, string> = {
  "Cash In": "Customer hands you cash. Your wallet sends them e-money.",
  "Cash Out": "Customer sends you e-money. You hand them cash.",
  "Telco Load": "Customer hands you cash. You send them load.",
  "Bills Payment": "Customer hands you cash. You pay their bill.",
  "Bank Transfer": "Customer hands you cash. You transfer it to their bank.",
  "Profit Remittance": "You take earnings out of the drawer. No customer.",
};

const ACCOUNT_LABEL: Record<string, string> = {
  cash: "Drawer cash",
  revenue: "Your earnings",
  equity: "Owner's equity",
};

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

  const [txType, setTxType] = useState<TransactionType>("Cash In");
  const [platform, setPlatform] = useState("");
  const [amount, setAmount] = useState("");
  const [amountIncludesFee, setAmountIncludesFee] = useState(false);
  const [reference, setReference] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const needsPlatform = txType !== "Profit Remittance";

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
  }, [txType]);

  const amountPesos = useMemo(() => {
    // Exact, and null for anything that is not unambiguously an amount:
    // parseFloat read "1,850" as 1.
    const minor = parsePesosInput(amount);
    return minor !== null && minor > 0 ? minor / 100 : 0;
  }, [amount]);

  const preview = useMemo(() => {
    if (!context || amountPesos <= 0) return null;
    if (needsPlatform && !platform) return null;
    try {
      return previewEntry(
        { transactionType: txType, platform, amountPesos, amountIncludesFee },
        context.rules
      );
    } catch {
      // buildPostings rejects inputs the ledger would refuse — a Cash Out whose
      // fee exceeds the amount, for one. Showing no preview is the honest
      // answer; Save will report why.
      return null;
    }
  }, [context, amountPesos, needsPlatform, platform, txType, amountIncludesFee]);

  const canSave =
    !saving && amountPesos > 0 && (!needsPlatform || platform !== "") && preview !== null;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await createAndConfirmTransaction({
        transactionType: txType,
        platform,
        amountPesos,
        referenceNumber: reference.trim() || null,
        accountNumber: accountNumber.trim() || null,
        amountIncludesFee,
        idempotencyKey: idempotencyKey.current,
      });
      router.push("/transactions");
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

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground max-w-[390px] mx-auto">
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link
          href="/"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold">New transaction</h1>
          <p className="text-xs text-muted-foreground">Type it in — no receipt needed</p>
        </div>
        <Link
          href="/capture"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
          title="Use a receipt screenshot instead"
        >
          <Camera className="w-4 h-4 text-muted-foreground" />
        </Link>
      </header>

      {loadError && (
        <div className="mx-5 mb-4 rounded-xl bg-red-500/10 border border-red-500/20 p-3 flex gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">{loadError}</p>
        </div>
      )}

      {context && context.platforms.length === 0 && (
        <div className="mx-5 mb-4 rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 flex gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200">
            You have no wallets set up yet. Add one in{" "}
            <Link href="/settings/platforms" className="underline">Settings → Platforms</Link>{" "}
            before recording a transaction.
          </p>
        </div>
      )}

      <section className="px-5 flex-1 space-y-5 pb-32">
        {/* ----- type ----- */}
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            What happened
          </label>
          <div className="grid grid-cols-3 gap-2">
            {TRANSACTION_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTxType(t)}
                className={`rounded-xl py-2.5 text-xs font-medium transition-colors ${
                  txType === t
                    ? "bg-emerald-500 text-black"
                    : "bg-white/[0.07] text-muted-foreground"
                }`}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed pt-0.5">
            {TYPE_HINT[txType]}
          </p>
        </div>

        {/* ----- platform ----- */}
        {needsPlatform && (
          <div className="space-y-2">
            <label htmlFor="platform" className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Which wallet
            </label>
            {/* A native select, not a styled listbox: on a phone this opens the
                OS picker, which is faster one-handed and needs no scroll
                trapping. */}
            <select
              id="platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full rounded-xl bg-white/[0.07] px-4 py-3 text-sm appearance-none"
            >
              <option value="">Choose a wallet…</option>
              {context?.platforms.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        )}

        {/* ----- amount ----- */}
        <div className="space-y-2">
          <label htmlFor="amount" className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Amount
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-muted-foreground">
              ₱
            </span>
            <input
              id="amount"
              // `decimal`, not `numeric`: it gives a keypad with a decimal
              // separator, and amounts with centavos do occur on bills.
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl bg-white/[0.07] pl-11 pr-4 py-4 text-2xl font-semibold tabular-nums"
            />
          </div>

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
                {/* Never inferred. The old code guessed, and because the gross of
                    any whole peso divides cleanly at 2%, every amount divisible
                    by 51 tripped the guess and was charged about a peso short. */}
              </span>
            </button>
          )}
        </div>

        {/* ----- live preview ----- */}
        {preview && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Your fee</span>
              <span className="text-lg font-semibold text-emerald-400 tabular-nums">
                {formatPesos(preview.feePesos)}
              </span>
            </div>

            {!preview.rule && (
              <p className="text-[11px] text-amber-300 leading-relaxed">
                No fee rule covers {txType}
                {needsPlatform && ` on ${platform}`} yet, so this earns nothing.
                Set one in <Link href="/settings/rules" className="underline">Settings → Fees</Link>.
              </p>
            )}

            <div className="h-px bg-white/[0.06]" />

            <div className="space-y-1.5">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                What this changes
              </span>
              {preview.postings.map((p, i) => {
                const label =
                  p.account.kind === "platform"
                    ? p.account.platform
                    : ACCOUNT_LABEL[p.account.kind] ?? p.account.kind;
                const pesos = p.amount / 100;
                return (
                  <div key={i} className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span
                      className={`tabular-nums font-medium ${
                        pesos > 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {pesos > 0 ? "+" : "−"}{formatPesos(Math.abs(pesos))}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ----- optional details ----- */}
        <div>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${showDetails ? "rotate-180" : ""}`}
            />
            Reference number, customer number
          </button>

          {showDetails && (
            <div className="space-y-3 pt-3">
              <div className="space-y-1.5">
                <label htmlFor="reference" className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Reference number
                </label>
                <input
                  id="reference"
                  // Text, not number: references have leading zeros, and a
                  // number input silently drops them.
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full rounded-xl bg-white/[0.07] px-4 py-3 text-sm tabular-nums"
                />
                <p className="text-[10px] text-muted-foreground">
                  Optional, but it is what stops the same transaction being recorded twice.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="account" className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Customer number
                </label>
                <input
                  id="account"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="w-full rounded-xl bg-white/[0.07] px-4 py-3 text-sm tabular-nums"
                />
              </div>
            </div>
          )}
        </div>

        {saveError && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 flex gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 leading-relaxed">{saveError}</p>
          </div>
        )}
      </section>

      {/* ----- save ----- */}
      <div className="fixed bottom-0 left-0 right-0 max-w-[390px] mx-auto px-5 pb-8 pt-4 bg-gradient-to-t from-background via-background to-transparent">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="w-full rounded-xl bg-emerald-500 text-black font-semibold py-4 text-sm disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving…
            </>
          ) : preview ? (
            `Record — you earn ${formatPesos(preview.feePesos)}`
          ) : (
            "Record transaction"
          )}
        </button>
      </div>
    </div>
  );
}
