"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Loader2,
  CreditCard,
  Check,
  AlertCircle,
  Scale,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { supabase } from "@/lib/supabase/client";
import {
  postReconciliation,
  reconciliationDifferenceMinor,
  formatMinorPesos,
  formatPesos,
  type LedgerAccount,
} from "@/lib/ledger";

// ---------------------------------------------------------------------------
// Card colours
//
// This screen used to persist a chosen colour on `wallets.color` and let the
// operator pick one. `wallets` is gone and `gocash.accounts` has no colour
// column, so the picker is removed rather than repointed at a column that does
// not exist (Audit #5 finding 7 — the old select on `color` errored and
// silently rendered an empty wallet list). The gradient is derived from the
// account name instead: the cards look the same, each account's colour is
// stable, and nothing has to be stored to get it.
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
  { id: "blue",    gradient: "from-blue-500 via-blue-600 to-blue-700",          accent: "text-blue-400" },
  { id: "purple",  gradient: "from-purple-500 via-purple-600 to-purple-700",    accent: "text-purple-400" },
  { id: "emerald", gradient: "from-emerald-500 via-emerald-600 to-emerald-700", accent: "text-emerald-400" },
  { id: "rose",    gradient: "from-rose-500 via-rose-600 to-rose-700",          accent: "text-rose-400" },
  { id: "orange",  gradient: "from-orange-500 via-orange-600 to-orange-700",    accent: "text-orange-400" },
  { id: "amber",   gradient: "from-amber-500 via-amber-600 to-amber-700",       accent: "text-amber-400" },
  { id: "cyan",    gradient: "from-cyan-500 via-cyan-600 to-cyan-700",          accent: "text-cyan-400" },
  { id: "zinc",    gradient: "from-zinc-600 via-zinc-700 to-zinc-800",          accent: "text-zinc-400" },
] as const;

// Matches the dashboard's wallet cards so one account looks the same everywhere.
const NAMED_COLORS: Record<string, string> = {
  GCash: "blue",
  MariBank: "purple",
  Maya: "emerald",
  Cash: "emerald",
};

function getColor(name: string) {
  const named = NAMED_COLORS[name];
  if (named) return COLOR_PALETTE.find((c) => c.id === named) ?? COLOR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A row of gocash.account_balances, restricted to the wallet-like kinds. */
interface AccountRow extends LedgerAccount {
  /** Sign-corrected book balance in pesos — what a human should read. */
  natural_balance: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WalletsSettingsPage() {
  const { operatorId, loading: authLoading } = useAuthGuard();

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Reconciliation state
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [countedValue, setCountedValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId;
    async function fetchAccounts() {
      // Derived balances. There is no stored balance left to read.
      const { data, error: readError } = await supabase
        .from("account_balances")
        .select("account_id, name, kind, balance_minor, natural_balance")
        .eq("operator_id", opId)
        // `revenue` and `equity` are bookkeeping accounts: an operator cannot
        // count a drawer of "fees earned", so they are neither wallets nor
        // reconcilable and are not listed here.
        .in("kind", ["platform", "cash"])
        .order("kind")
        .order("name");

      if (readError) setError(readError.message);
      if (data) setAccounts(data as AccountRow[]);
      setDataLoading(false);
    }
    fetchAccounts();
  }, [operatorId]);

  function startReconcile(account: AccountRow) {
    setReconcilingId(account.account_id);
    // Pre-filled with the book balance, so the operator corrects a number
    // rather than retyping one that probably already matches.
    setCountedValue(account.natural_balance.toFixed(2));
    setError(null);
  }

  function cancelReconcile() {
    setReconcilingId(null);
    setCountedValue("");
    setError(null);
  }

  /** What the correction would post, in centavos; null while the field is unparseable. */
  function differenceMinor(account: AccountRow): number | null {
    const counted = parseFloat(countedValue);
    if (!Number.isFinite(counted)) return null;
    return reconciliationDifferenceMinor({
      operatorId: operatorId ?? "",
      account,
      countedPesos: counted,
    });
  }

  async function submitReconcile(account: AccountRow) {
    if (!operatorId) return;
    const counted = parseFloat(countedValue);
    if (!Number.isFinite(counted) || counted < 0) {
      setError("Enter the amount you counted");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Posts a correction entry — the difference against the ledger, with the
      // owner's equity as the balancing leg.
      //
      // This REPLACES the inline balance editor, which ran
      // `UPDATE gocash.wallets SET balance = ...` straight from the browser: an
      // overwrite that left no trace at all (Audit #5 finding 14) and that a
      // derived balance makes impossible in any case. The operator can still
      // correct a wrong balance; now the correction is a visible posting that
      // says how much and when, instead of a number quietly replaced.
      await postReconciliation({
        operatorId,
        account,
        countedPesos: counted,
        memo: "Counted in Settings → Wallets",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post the correction");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || dataLoading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground max-w-[390px] mx-auto">
      {/* Header */}
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link
          href="/settings"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <div>
          <h1 className="text-base font-semibold">Wallets</h1>
          <p className="text-xs text-muted-foreground">Check your balances against what you counted</p>
        </div>
      </header>

      {/* Account list */}
      <section className="px-5 flex-1 space-y-3 pb-10">
        {accounts.map((a) => {
          const color = getColor(a.name);
          const isReconciling = reconcilingId === a.account_id;
          const diff = isReconciling ? differenceMinor(a) : null;

          return (
            <div key={a.account_id} className="rounded-2xl overflow-hidden">
              {/* Card header — gradient derived from the account name */}
              <div className={`relative bg-gradient-to-br ${color.gradient} p-5 overflow-hidden`}>
                {/* Decorative blur */}
                <div className="absolute top-0 right-0 w-28 h-28 bg-white/10 rounded-full blur-2xl -translate-y-8 translate-x-8 pointer-events-none" />

                <div className="relative z-10 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
                      <CreditCard className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="text-white/70 text-xs font-medium">{a.name}</p>
                      {/* natural_balance, not balance: the sign-corrected figure
                          is the one a human should read. */}
                      <p className="text-white text-[22px] font-bold tracking-tight tabular-nums leading-tight">
                        {formatPesos(a.natural_balance)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reconciliation */}
              <div className="bg-white/[0.04] border border-white/[0.05] border-t-0 rounded-b-2xl">
                {isReconciling ? (
                  <div className="p-4 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Counted balance
                      </Label>
                      <div className="relative">
                        <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none ${color.accent}`}>
                          ₱
                        </span>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={countedValue}
                          onChange={(e) => setCountedValue(e.target.value)}
                          autoFocus
                          className="bg-white/[0.07] border-white/[0.1] h-11 rounded-xl pl-7 text-sm tabular-nums"
                        />
                      </div>
                    </div>

                    {/* The count against the books */}
                    <div className="rounded-xl bg-white/[0.04] px-3.5 py-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">Book balance</span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {formatPesos(a.natural_balance)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">Difference</span>
                        <span
                          className={[
                            "text-[13px] font-semibold tabular-nums",
                            diff === null || diff === 0
                              ? "text-muted-foreground"
                              : diff > 0
                                ? "text-emerald-400"
                                : "text-red-400",
                          ].join(" ")}
                        >
                          {diff === null ? "—" : (diff > 0 ? "+" : "") + formatMinorPesos(diff)}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 leading-relaxed pt-0.5">
                        {diff === null || diff === 0
                          ? "Your count matches the ledger — there is nothing to post."
                          : diff > 0
                            ? "You counted more than the ledger says. The difference is posted as a correction against the owner's equity."
                            : "You counted less than the ledger says. The difference is posted as a correction against the owner's equity."}
                      </p>
                    </div>

                    {error && (
                      <div className="flex items-start gap-2 text-xs text-red-400">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{error}</span>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => submitReconcile(a)}
                        disabled={saving || diff === null || diff === 0}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Post correction
                      </button>
                      <button
                        onClick={cancelReconcile}
                        className="px-4 py-2.5 bg-white/[0.07] text-muted-foreground font-medium rounded-xl text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => startReconcile(a)}
                    className="w-full px-4 py-3 flex items-center gap-2 text-left text-sm text-muted-foreground hover:bg-white/[0.03] transition-colors"
                  >
                    <Scale className="w-3.5 h-3.5 flex-shrink-0" />
                    Reconcile against a count →
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <p className="text-[11px] text-muted-foreground/50 text-center pt-4 leading-relaxed">
          Balances are worked out from your transactions, so they cannot be typed over.
          When a count disagrees with the ledger, post the difference here — it stays on
          the record, so you can always see why a balance is what it is.
        </p>
      </section>
    </div>
  );
}
