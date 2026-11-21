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
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { supabase } from "@/lib/supabase/client";
import { addPlatform as addPlatformAccount, retirePlatform } from "@/lib/ledger";
import { Sheet } from "@/components/sheet";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";

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
  const { operatorId, loading: authLoading } = useAuthGuard({ ownerOnly: true });

  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  // Deactivate
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<PlatformAccount | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function restorePlatform(account: PlatformAccount) {
    setRestoringId(account.id);
    setError(null);
    try {
      const restored = await addPlatformAccount(account.name);
      setAccounts((prev) => [...prev.filter((a) => a.id !== account.id && a.id !== restored.id), restored]);
      showSuccess(`${account.name} is back`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not bring the wallet back");
    } finally {
      setRestoringId(null);
    }
  }

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
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  const platforms = accounts.filter((a) => a.kind === "platform" && a.is_active);
  const archived = accounts.filter((a) => a.kind === "platform" && !a.is_active);
  const cashAccount = accounts.find((a) => a.kind === "cash" && a.is_active);

  return (
    <AppShell active="settings">
      {/* Header */}
      <PageHeader
        title="Platforms"
        back="/settings"
        info={<>
          <p>Each wallet you use gets its own balance and fee rules.</p>
          <p>A new wallet starts at ₱0. Set its real balance under <b>Settings → Wallets</b>.</p>
          <p>Archive any wallet you don&apos;t use. It is hidden, its history is kept, and you can bring it back.</p>
        </>}
      />

      <section className="px-5 flex-1 space-y-3 pb-10">
        {/* Success banner */}
        {successMsg && (
          <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-xl px-4 py-2.5">
            <Check className="w-4 h-4 text-primary flex-shrink-0" />
            <p className="text-[15px] text-primary font-medium">{successMsg}</p>
          </div>
        )}

        {/* Platform accounts */}
        {platforms.map((a) => {
          const isDeactivating = deactivatingId === a.id;

          return (
            <div
              key={a.id}
              className="flex items-center gap-3 bg-muted rounded-[20px] px-4 py-3.5"
            >
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-4 h-4 text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold">{a.name}</p>
              </div>

              <button
                onClick={() => setArchiving(a)}
                disabled={isDeactivating}
                className="btn btn-outline btn-sm"
              >
                {isDeactivating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Archive"}
              </button>
            </div>
          );
        })}

        {/* Cash account — always shown, cannot be deactivated */}
        {cashAccount && (
          <div className="flex items-center gap-3 bg-muted rounded-[20px] px-4 py-3.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold">Cash</p>
              <p className="text-[13px] text-muted-foreground">Physical cash register</p>
            </div>
          </div>
        )}

        {archived.length > 0 && (
          <div className="pt-2">
            <p className="label">Archived</p>
            <div className="space-y-2">
              {archived.map((a) => (
                <div key={a.id} className="flex items-center gap-3 card px-4 py-3">
                  <p className="flex-1 min-w-0 text-[15px] font-semibold text-muted-foreground">{a.name}</p>
                  <button onClick={() => restorePlatform(a)} disabled={restoringId === a.id} className="btn btn-secondary btn-sm bg-background">
                    {restoringId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Bring back"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add Platform */}
        {showAdd ? (
          <div className="bg-muted rounded-[20px] p-4 space-y-3">
            <div className="space-y-1.5">
              <label className="label">
                Platform name
              </label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Maya, PayMaya"
                autoFocus
                className="bg-muted border-border h-10 rounded-xl text-[15px]"
              />
            </div>

            {/*
              The "Opening balance" field that used to sit here is gone. A balance
              is now the sum of an account's postings, so an opening figure has to
              be a posted entry rather than a number written into a column. Set it
              in Settings → Wallets, where a count against an empty ledger posts
              exactly that.
            */}

            {error && (
              <div className="flex items-center gap-2 text-[13px] text-destructive">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={addPlatform}
                disabled={adding}
                className="btn btn-primary btn-sm flex-1"
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
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setShowAdd(true); setError(null); }}
            className="w-full flex items-center justify-center gap-2 bg-muted border-dashed rounded-[20px] py-3.5 text-[15px] text-muted-foreground hover:bg-muted transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add a wallet
          </button>
        )}

      </section>
      <Sheet open={archiving !== null} onClose={() => setArchiving(null)} title={`Archive ${archiving?.name ?? "wallet"}?`}>
        <ul className="text-[15px] text-muted-foreground space-y-1.5 mt-2 mb-5 list-disc pl-5">
          <li>It disappears from Home and from new transactions.</li>
          <li>Its past transactions stay in History.</li>
          <li>A wallet that still holds money cannot be archived. Move the money out first.</li>
        </ul>
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => {
              const target = archiving;
              setArchiving(null);
              if (target) deactivatePlatform(target);
            }}
            className="btn btn-danger w-full"
          >
            Archive
          </button>
          <button
            type="button"
            onClick={() => setArchiving(null)}
            className="btn btn-secondary w-full"
          >
            Keep it
          </button>
        </div>
      </Sheet>
    </AppShell>
  );
}
