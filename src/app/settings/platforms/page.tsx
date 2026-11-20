"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Loader2,
  Plus,
  CreditCard,
  AlertCircle,
  Check,
  Archive,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { supabase } from "@/lib/supabase/client";
import { addPlatform as addPlatformAccount, retirePlatform } from "@/lib/ledger";
import { AppShell } from "@/components/app-shell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// A row of gocash.accounts. This screen used to create a `wallets` row per
// platform; `wallets` is being dropped and an account has no balance column —
// balances are derived from the ledger.
interface PlatformAccount {
  id: string;
  name: string;
  kind: string;
  is_active: boolean;
}

// Built-in platforms cannot be deactivated
const BUILT_IN = new Set(["GCash", "MariBank", "Maya", "Cash"]);

// NOTE: adding a platform used to seed six `transaction_rules` rows alongside
// the wallet. It no longer seeds anything, for two reasons. Direction — the
// three delta_* multipliers — is not data any more; it lives in
// `supabase/functions/_core/postings.ts`, which is the whole point of the
// ledger rebuild. And pricing has an explicit fallback: `resolveFeeRule` in
// `@core/fees.ts` uses the operator's `platform = 'all'` fee rule when no
// exact match exists, so a new platform is priced correctly the moment it is
// created. Per-platform overrides belong in Settings → Profit Rules.

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlatformsSettingsPage() {
  const { operatorId, loading: authLoading } = useAuthGuard();

  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  // Deactivate
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  // Feedback
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId;
    async function fetchAccounts() {
      // Inactive accounts are fetched too: they still hold their name (accounts
      // are unique per operator on it) and their postings, so the add form has
      // to know about them even though they are not listed.
      const { data } = await supabase
        .from("accounts")
        .select("id, name, kind, is_active")
        .eq("operator_id", opId)
        .order("kind")
        .order("name");
      if (data) setAccounts(data);
      setDataLoading(false);
    }
    fetchAccounts();
  }, [operatorId]);

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 2500);
  }

  async function addPlatform() {
    if (!operatorId) return;
    const trimmed = newName.trim();
    if (!trimmed) {
      setError("Enter a platform name");
      return;
    }
    // An active wallet with this name is a clash. A removed one is not: the
    // server brings it back with its history.
    const clash = accounts.find(
      (a) => a.is_active && a.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (clash) {
      setError("You already have a wallet with this name");
      return;
    }

    setAdding(true);
    setError(null);

    // Through the server: the browser cannot write gocash.accounts. The new
    // wallet starts at zero; its real balance is set in Settings → Wallets,
    // which posts the figure as a counted correction.
    let newAccount: PlatformAccount;
    try {
      newAccount = await addPlatformAccount(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add the wallet");
      setAdding(false);
      return;
    }

    setAccounts((prev) => [...prev.filter((a) => a.id !== newAccount.id), newAccount]);
    setNewName("");
    setShowAdd(false);
    setAdding(false);
    showSuccess(`${trimmed} added`);
  }

  /**
   * Deactivate a platform.
   *
   * This REPLACES deletion. The old version issued a DELETE against `wallets`,
   * which silently did nothing — no DELETE policy exists, so PostgREST reported
   * success on 0 rows affected and the platform came back on refresh (Audit #5
   * finding 6). With an append-only ledger, deleting is not the right answer
   * either: an account with postings is referenced by every entry it appears in
   * (the FK is ON DELETE RESTRICT), and removing it would erase the explanation
   * for balances that still exist. Deactivating keeps the history and takes the
   * platform out of circulation, which is what the operator actually wanted.
   */
  async function deactivatePlatform(account: PlatformAccount) {
    if (!operatorId) return;
    setDeactivatingId(account.id);
    setError(null);

    // Through the server, which refuses while the wallet still holds a
    // balance: a hidden wallet with money in it is money the screen can no
    // longer account for.
    try {
      await retirePlatform(account.id);
    } catch (err) {
      setDeactivatingId(null);
      setError(err instanceof Error ? err.message : "Could not remove the wallet");
      return;
    }
    setDeactivatingId(null);

    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, is_active: false } : a))
    );
    showSuccess(`${account.name} deactivated — its history is kept`);
  }

  if (authLoading || dataLoading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  const platforms = accounts.filter((a) => a.kind === "platform" && a.is_active);
  const cashAccount = accounts.find((a) => a.kind === "cash" && a.is_active);

  return (
    <AppShell active="settings">
      {/* Header */}
      <header className="px-5 pt-14 lg:pt-10 pb-4 flex items-center gap-3">
        <Link
          href="/settings"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <div>
          <h1 className="text-base font-semibold">Platforms</h1>
          <p className="text-xs text-muted-foreground">Apps you use for transactions</p>
        </div>
      </header>

      <section className="px-5 flex-1 space-y-3 pb-10">
        {/* Success banner */}
        {successMsg && (
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5">
            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <p className="text-sm text-emerald-400 font-medium">{successMsg}</p>
          </div>
        )}

        {/* Platform accounts */}
        {platforms.map((a) => {
          const isBuiltIn = BUILT_IN.has(a.name);
          const isDeactivating = deactivatingId === a.id;

          return (
            <div
              key={a.id}
              className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.06] rounded-2xl px-4 py-3.5"
            >
              <div className="w-9 h-9 rounded-xl bg-white/[0.08] flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-4 h-4 text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{a.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {isBuiltIn ? "Built-in" : "Custom platform"}
                </p>
              </div>

              {!isBuiltIn && (
                <button
                  onClick={() => deactivatePlatform(a)}
                  disabled={isDeactivating}
                  title="Deactivate — past transactions are kept"
                  className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                >
                  {isDeactivating ? (
                    <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                  ) : (
                    <Archive className="w-3.5 h-3.5 text-amber-400" />
                  )}
                </button>
              )}
            </div>
          );
        })}

        {/* Cash account — always shown, cannot be deactivated */}
        {cashAccount && (
          <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.06] rounded-2xl px-4 py-3.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Cash</p>
              <p className="text-[11px] text-muted-foreground">Physical cash register</p>
            </div>
          </div>
        )}

        {/* Add Platform */}
        {showAdd ? (
          <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Platform name
              </Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Maya, PayMaya"
                autoFocus
                className="bg-white/[0.07] border-white/[0.1] h-10 rounded-xl text-sm"
              />
            </div>

            {/*
              The "Opening balance" field that used to sit here is gone. A balance
              is now the sum of an account's postings, so an opening figure has to
              be a posted entry rather than a number written into a column. Set it
              in Settings → Wallets, where a count against an empty ledger posts
              exactly that.
            */}
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
              New platforms start at ₱0.00. Set the opening balance in
              Settings → Wallets by reconciling against what you have counted.
            </p>

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={addPlatform}
                disabled={adding}
                className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                {adding ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Add Platform
              </button>
              <button
                onClick={() => { setShowAdd(false); setError(null); setNewName(""); }}
                className="px-4 py-2.5 bg-white/[0.07] text-muted-foreground font-medium rounded-xl text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setShowAdd(true); setError(null); }}
            className="w-full flex items-center justify-center gap-2 bg-white/[0.04] border border-dashed border-white/[0.1] rounded-2xl py-3.5 text-sm text-muted-foreground hover:bg-white/[0.06] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add a new platform
          </button>
        )}

        <p className="text-[11px] text-muted-foreground/50 text-center pt-4 leading-relaxed">
          Each platform gets its own account and profit rules.
          Platforms are deactivated rather than deleted, so past transactions keep
          their history. Built-in platforms (GCash, MariBank) stay put.
        </p>
      </section>
    </AppShell>
  );
}
