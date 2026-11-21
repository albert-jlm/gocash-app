"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  Loader2,
  CreditCard,
  Check,
  AlertCircle,
  Scale,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { supabase } from "@/lib/supabase/client";
import {
  postReconciliation,
  reconciliationDifferenceMinor,
  formatMinorPesos,
  formatPesos,
  type LedgerAccount,
  newIdempotencyKey,
} from "@/lib/ledger";
import { parsePesosInput } from "@core/money.ts";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Sheet } from "@/components/sheet";
import { loadFloors, saveFloor, type Floors } from "@/lib/low-balance";
import { formatAmountInput } from "@/lib/display";

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
  { id: "emerald", gradient: "from-emerald-500 via-emerald-600 to-emerald-700", accent: "text-primary" },
  { id: "rose",    gradient: "from-rose-500 via-rose-600 to-rose-700",          accent: "text-rose-400" },
  { id: "orange",  gradient: "from-orange-500 via-orange-600 to-orange-700",    accent: "text-orange-400" },
  { id: "amber",   gradient: "from-amber-500 via-amber-600 to-amber-700",       accent: "text-warning" },
  { id: "cyan",    gradient: "from-cyan-500 via-cyan-600 to-cyan-700",          accent: "text-cyan-400" },
  { id: "zinc",    gradient: "from-zinc-600 via-zinc-700 to-zinc-800",          accent: "text-muted-foreground" },
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
  const { operatorId, loading: authLoading } = useAuthGuard({ ownerOnly: true });

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Reconciliation state
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [countedValue, setCountedValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the last correction did, shown once it has posted. Without it the
  // form simply stayed open on the old balance and the operator could not
  // tell whether anything had happened.
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // One key per count, so a double tap or a retry posts one correction.
  const reconcileKey = useRef<string>(newIdempotencyKey("reconcile"));
  const [floors, setFloors] = useState<Floors>({});
  const [floorFor, setFloorFor] = useState<AccountRow | null>(null);
  const [floorInput, setFloorInput] = useState("");
  const [floorSaving, setFloorSaving] = useState(false);
  const [floorError, setFloorError] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorId) return;
    loadFloors(operatorId).then(setFloors).catch(() => {});
  }, [operatorId]);

  async function submitFloor(clear: boolean) {
    if (!operatorId || !floorFor) return;
    const minor = clear ? 0 : parsePesosInput(floorInput);
    if (minor === null || minor < 0) {
      setFloorError("Enter an amount like 2,000");
      return;
    }
    setFloorSaving(true);
    setFloorError(null);
    try {
      setFloors(await saveFloor(operatorId, floorFor.name, minor > 0 ? minor / 100 : null));
      setFloorFor(null);
    } catch (err) {
      setFloorError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setFloorSaving(false);
    }
  }

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

      const { data: hiddenRows } = await supabase
        .from("accounts").select("id").eq("operator_id", opId).eq("is_active", false);
      const hidden = new Set((hiddenRows ?? []).map((a) => a.id));
      if (readError) setError(readError.message);
      if (data) setAccounts((data as AccountRow[]).filter((a) => !hidden.has(a.account_id)));
      setDataLoading(false);
    }
    fetchAccounts();
  }, [operatorId, reloadTick]);

  function startReconcile(account: AccountRow) {
    setReconcilingId(account.account_id);
    // Pre-filled with the book balance, so the operator corrects a number
    // rather than retyping one that probably already matches.
    setCountedValue(account.natural_balance.toFixed(2));
    setError(null);
    setNotice(null);
    reconcileKey.current = newIdempotencyKey("reconcile");
  }

  function cancelReconcile() {
    setReconcilingId(null);
    setCountedValue("");
    setError(null);
  }

  /** What the correction would post, in centavos; null while the field is unparseable. */
  function differenceMinor(account: AccountRow): number | null {
    const countedMinor = parsePesosInput(countedValue);
    if (countedMinor === null) return null;
    const counted = countedMinor / 100;
    return reconciliationDifferenceMinor({
      operatorId: operatorId ?? "",
      account,
      countedPesos: counted,
    });
  }

  async function submitReconcile(account: AccountRow) {
    if (!operatorId) return;
    // Exact or refused. parseFloat read a counted "12,500" as 12, and the
    // correction it posted would have written off the other 12,488.
    const countedMinor = parsePesosInput(countedValue);
    if (countedMinor === null) {
      setError("Enter the amount you counted, for example 12500 or 12,500.50");
      return;
    }
    const counted = countedMinor / 100;

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
        idempotencyKey: reconcileKey.current,
      });

      const diff = reconciliationDifferenceMinor({ operatorId, account, countedPesos: counted });
      setNotice(
        `${account.name}: ${diff > 0 ? "added" : "removed"} ${formatMinorPesos(Math.abs(diff))}. ` +
        `The balance now matches your count of ${formatPesos(counted)}.`
      );
      setReconcilingId(null);
      setCountedValue("");
      setReloadTick((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post the correction");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || dataLoading) {
    return (
      <AppShell active="settings">
        <div className="flex-1 grid place-items-center">
          <Loader2 className="late w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="settings">
      {/* Header */}
      <PageHeader
        title="Wallets"
        back="/settings"
        info={<>
          <p>Type what you actually counted for a wallet or the drawer. The balance changes to match, and the correction is kept on record.</p>
          <p>Use this to enter your opening balances too.</p>
          <p><b>Alert below</b> sets the amount at which Home tells you a wallet needs topping up.</p>
        </>}
      />

      {/* Account list */}
      <section className="px-5 flex-1 space-y-3 pb-10">
        {notice && (
          <div className="flex items-start gap-2.5 bg-primary/10 border border-primary/20 rounded-2xl px-4 py-3">
            <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-primary leading-relaxed">{notice}</p>
          </div>
        )}
        {accounts.map((a) => {
          const isReconciling = reconcilingId === a.account_id;
          const diff = isReconciling ? differenceMinor(a) : null;

          return (
            <div key={a.account_id} className="rounded-2xl overflow-hidden">
              {/* Card header — gradient derived from the account name */}
              <div className="relative bg-muted p-5 overflow-hidden">

                <div className="relative z-10 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-background rounded-full flex items-center justify-center">
                      <CreditCard className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="opacity-75 text-[13px] font-medium">{a.name}</p>
                      {/* natural_balance, not balance: the sign-corrected figure
                          is the one a human should read. */}
                      <p className="amount text-[22px] font-semibold tracking-tight leading-tight">
                        {formatPesos(a.natural_balance)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reconciliation */}
              <div className="bg-muted border border-border border-t-0 rounded-b-2xl">
                {isReconciling ? (
                  <div className="p-4 space-y-3">
                    <div className="space-y-1.5">
                      <label className="label">
                        What it really holds
                      </label>
                      <div className="relative">
                        <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[15px] pointer-events-none text-muted-foreground`}>
                          ₱
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={countedValue}
                          onChange={(e) => setCountedValue(e.target.value)}
                          autoFocus
                          className="bg-muted border-border h-11 rounded-xl pl-7 text-[15px] tabular-nums"
                        />
                      </div>
                    </div>

                    {/* The count against the books */}
                    <div className="rounded-xl bg-muted px-3.5 py-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-muted-foreground">Book balance</span>
                        <span className="text-[13px] tabular-nums text-muted-foreground">
                          {formatPesos(a.natural_balance)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-muted-foreground">Difference</span>
                        <span
                          className={[
                            "text-[13px] font-semibold tabular-nums",
                            diff === null || diff === 0
                              ? "text-muted-foreground"
                              : diff > 0
                                ? "text-primary"
                                : "text-destructive",
                          ].join(" ")}
                        >
                          {diff === null ? "—" : (diff > 0 ? "+" : "") + formatMinorPesos(diff)}
                        </span>
                      </div>
                      <p className="text-[13px] text-muted-foreground/60 leading-relaxed pt-0.5">
                        {diff === null || diff === 0
                          ? "This matches. Nothing to change."
                          : diff > 0
                            ? "The balance will go up by this much. The correction is kept on record."
                            : "The balance will go down by this much. The correction is kept on record."}
                      </p>
                    </div>

                    {error && (
                      <div className="flex items-start gap-2 text-[13px] text-destructive">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{error}</span>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => submitReconcile(a)}
                        disabled={saving || diff === null || diff === 0}
                        className="btn btn-primary btn-sm flex-1"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Save
                      </button>
                      <button
                        onClick={cancelReconcile}
                        className="btn btn-secondary btn-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 p-3">
                    <button onClick={() => startReconcile(a)} className="btn btn-primary btn-sm">
                      Set balance
                    </button>
                    <button
                      onClick={() => {
                        setFloorFor(a);
                        setFloorInput(floors[a.name] ? formatAmountInput(String(floors[a.name])) : "");
                        setFloorError(null);
                      }}
                      className="btn btn-outline btn-sm"
                    >
                      {floors[a.name] ? `Alert at ${formatPesos(floors[a.name]).replace(/\.00$/, "")}` : "Set alert"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

      </section>
      <Sheet open={floorFor !== null} onClose={() => setFloorFor(null)} title={`Alert when ${floorFor?.name === "Cash" ? "the cash drawer" : floorFor?.name ?? "it"} is low`}>
        <p className="text-[15px] text-muted-foreground mt-1 mb-4">Home tells you to top up when the balance drops below this.</p>
        <label htmlFor="floor-amount" className="sr-only">Amount</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">₱</span>
          <input
            id="floor-amount"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            placeholder="2,000"
            value={floorInput}
            onChange={(e) => setFloorInput(formatAmountInput(e.target.value))}
            className="amount w-full h-[54px] rounded-2xl bg-muted pl-9 pr-4 text-xl font-semibold"
          />
        </div>
        {floorError && <p className="text-[15px] text-destructive mt-2">{floorError}</p>}
        <div className="space-y-2.5 mt-4">
          <button
            type="button"
            onClick={() => submitFloor(false)}
            disabled={floorSaving}
            className="btn btn-primary w-full"
          >
            {floorSaving ? "Saving…" : "Save"}
          </button>
          {floorFor && floors[floorFor.name] ? (
            <button
              type="button"
              onClick={() => submitFloor(true)}
              disabled={floorSaving}
              className="btn btn-secondary w-full"
            >
              Turn off
            </button>
          ) : null}
        </div>
      </Sheet>
    </AppShell>
  );
}
