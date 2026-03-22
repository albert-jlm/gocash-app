"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  CreditCard,
  AlertCircle,
  Check,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { supabase } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlatformWallet {
  id: string;
  wallet_name: string;
  wallet_type: string;
  balance: number;
}

// Built-in platforms cannot be deleted
const BUILT_IN = new Set(["GCash", "MariBank", "Cash"]);

// Default rules to seed when adding a new platform
const DEFAULT_PLATFORM_RULES = [
  { transaction_type: "Cash In",           delta_platform_mult: 1,  delta_cash_amount_mult: -1, delta_cash_mult: 1, profit_rate: 2,    profit_minimum: 5  },
  { transaction_type: "Cash Out",          delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 1, profit_rate: 2,    profit_minimum: 5  },
  { transaction_type: "Telco Load",        delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 1, profit_rate: 3,    profit_minimum: 3  },
  { transaction_type: "Bills Payment",     delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 0, profit_rate: 0,    profit_minimum: 5  },
  { transaction_type: "Bank Transfer",     delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 0, profit_rate: 0,    profit_minimum: 5  },
  { transaction_type: "Profit Remittance", delta_platform_mult: 0,  delta_cash_amount_mult: -1, delta_cash_mult: 0, profit_rate: null, profit_minimum: null },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlatformsSettingsPage() {
  const { operatorId, loading: authLoading } = useAuthGuard();

  const [wallets, setWallets] = useState<PlatformWallet[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [adding, setAdding] = useState(false);

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Feedback
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId;
    async function fetch() {
      const { data } = await supabase
        .from("wallets")
        .select("id, wallet_name, wallet_type, balance")
        .eq("operator_id", opId)
        .order("wallet_type")
        .order("wallet_name");
      if (data) setWallets(data);
      setDataLoading(false);
    }
    fetch();
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
    if (wallets.some((w) => w.wallet_name.toLowerCase() === trimmed.toLowerCase())) {
      setError("A platform with this name already exists");
      return;
    }

    setAdding(true);
    setError(null);

    const balance = parseFloat(newBalance) || 0;

    // 1. Create wallet
    const { data: newWallet, error: walletErr } = await supabase
      .from("wallets")
      .insert({
        operator_id: operatorId,
        wallet_type: "platform" as const,
        wallet_name: trimmed,
        balance,
      })
      .select("id, wallet_name, wallet_type, balance")
      .single();

    if (walletErr || !newWallet) {
      setError(walletErr?.message ?? "Failed to create wallet");
      setAdding(false);
      return;
    }

    // 2. Seed transaction rules for this platform
    await supabase.from("transaction_rules").insert(
      DEFAULT_PLATFORM_RULES.map((r) => ({
        ...r,
        operator_id: operatorId,
        platform: trimmed,
        is_active: true,
      }))
    );

    setWallets((prev) => [...prev, newWallet]);
    setNewName("");
    setNewBalance("");
    setShowAdd(false);
    setAdding(false);
    showSuccess(`${trimmed} added`);
  }

  async function deletePlatform(wallet: PlatformWallet) {
    if (!operatorId) return;
    setDeletingId(wallet.id);
    setError(null);

    // Delete transaction rules for this platform
    await supabase
      .from("transaction_rules")
      .delete()
      .eq("operator_id", operatorId)
      .eq("platform", wallet.wallet_name);

    // Delete wallet
    const { error: delErr } = await supabase
      .from("wallets")
      .delete()
      .eq("id", wallet.id);

    setDeletingId(null);

    if (delErr) {
      setError(delErr.message);
      return;
    }

    setWallets((prev) => prev.filter((w) => w.id !== wallet.id));
    showSuccess(`${wallet.wallet_name} removed`);
  }

  if (authLoading || dataLoading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  const platforms = wallets.filter((w) => w.wallet_type === "platform");
  const cashWallet = wallets.find((w) => w.wallet_type === "cash");

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

        {/* Platform wallets */}
        {platforms.map((w) => {
          const isBuiltIn = BUILT_IN.has(w.wallet_name);
          const isDeleting = deletingId === w.id;

          return (
            <div
              key={w.id}
              className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.06] rounded-2xl px-4 py-3.5"
            >
              <div className="w-9 h-9 rounded-xl bg-white/[0.08] flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-4 h-4 text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{w.wallet_name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {isBuiltIn ? "Built-in" : "Custom platform"}
                </p>
              </div>

              {!isBuiltIn && (
                <button
                  onClick={() => deletePlatform(w)}
                  disabled={isDeleting}
                  className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  {isDeleting ? (
                    <Loader2 className="w-3.5 h-3.5 text-red-400 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  )}
                </button>
              )}
            </div>
          );
        })}

        {/* Cash wallet — always shown, non-deletable */}
        {cashWallet && (
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
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Opening balance (₱)
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
                placeholder="0"
                className="bg-white/[0.07] border-white/[0.1] h-10 rounded-xl text-sm tabular-nums"
              />
            </div>

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
                onClick={() => { setShowAdd(false); setError(null); setNewName(""); setNewBalance(""); }}
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
          Each platform gets its own wallet and profit rules.
          Built-in platforms (GCash, MariBank) cannot be removed.
        </p>
      </section>
    </div>
  );
}
