"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
import {
  comparePlatformNames,
  getDefaultWalletColor,
} from "@/lib/platforms";

interface OperatorPlatform {
  id: string;
  name: string;
  is_builtin: boolean;
  is_active: boolean;
  walletId: string | null;
  balance: number;
}

interface WalletRow {
  id: string;
  wallet_name: string;
  wallet_type: string;
  balance: number;
  is_active: boolean;
}

const DEFAULT_PLATFORM_RULES = [
  { transaction_type: "Cash In",           delta_platform_mult: 1,  delta_cash_amount_mult: -1, delta_cash_mult: 1, profit_rate: 2,    profit_minimum: 5  },
  { transaction_type: "Cash Out",          delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 1, profit_rate: 2,    profit_minimum: 5  },
  { transaction_type: "Telco Load",        delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 1, profit_rate: 3,    profit_minimum: 3  },
  { transaction_type: "Bills Payment",     delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 0, profit_rate: 0,    profit_minimum: 5  },
  { transaction_type: "Bank Transfer",     delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 0, profit_rate: 0,    profit_minimum: 5  },
  { transaction_type: "Profit Remittance", delta_platform_mult: 0,  delta_cash_amount_mult: -1, delta_cash_mult: 0, profit_rate: null, profit_minimum: null },
];

export default function PlatformsSettingsPage() {
  const { operatorId, loading: authLoading } = useAuthGuard();

  const [platforms, setPlatforms] = useState<OperatorPlatform[]>([]);
  const [cashWallet, setCashWallet] = useState<WalletRow | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [adding, setAdding] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId;

    async function fetchData() {
      setDataLoading(true);

      const [platformsRes, walletsRes] = await Promise.all([
        supabase
          .from("operator_platforms")
          .select("id, name, is_builtin, is_active")
          .eq("operator_id", opId),
        supabase
          .from("wallets")
          .select("id, wallet_name, wallet_type, balance, is_active")
          .eq("operator_id", opId),
      ]);

      const wallets = (walletsRes.data ?? []) as WalletRow[];
      const walletByName = new Map(
        wallets.map((wallet) => [wallet.wallet_name.toLowerCase(), wallet])
      );

      const merged = ((platformsRes.data ?? []) as Array<{
        id: string;
        name: string;
        is_builtin: boolean;
        is_active: boolean;
      }>)
        .map((platform) => {
          const wallet = walletByName.get(platform.name.toLowerCase()) ?? null;
          return {
            ...platform,
            walletId: wallet?.id ?? null,
            balance: wallet?.balance ?? 0,
          };
        })
        .sort((a, b) => comparePlatformNames(a.name, b.name));

      setPlatforms(merged);
      setCashWallet(wallets.find((wallet) => wallet.wallet_name === "Cash" && wallet.is_active) ?? null);
      setDataLoading(false);
    }

    void fetchData();
  }, [operatorId]);

  function showSuccess(message: string) {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(null), 2500);
  }

  async function addPlatform() {
    if (!operatorId) return;

    const trimmed = newName.trim();
    if (!trimmed) {
      setError("Enter a platform name");
      return;
    }

    const existing = platforms.find(
      (platform) => platform.name.toLowerCase() === trimmed.toLowerCase()
    );

    if (existing?.is_active) {
      setError("A platform with this name already exists");
      return;
    }

    setAdding(true);
    setError(null);

    const balance = parseFloat(newBalance) || 0;
    const platformName = existing?.name ?? trimmed;

    try {
      if (existing) {
        const { error: reactivatePlatformError } = await supabase
          .from("operator_platforms")
          .update({ is_active: true })
          .eq("id", existing.id);

        if (reactivatePlatformError) throw new Error(reactivatePlatformError.message);

        if (existing.walletId) {
          const { error: walletError } = await supabase
            .from("wallets")
            .update({ is_active: true, balance })
            .eq("id", existing.walletId);

          if (walletError) throw new Error(walletError.message);
        } else {
          const { error: walletError } = await supabase
            .from("wallets")
            .insert({
              operator_id: operatorId,
              wallet_type: "platform",
              wallet_name: platformName,
              balance,
              color: getDefaultWalletColor(platformName),
              is_active: true,
            });

          if (walletError) throw new Error(walletError.message);
        }

        const { count } = await supabase
          .from("transaction_rules")
          .select("id", { count: "exact", head: true })
          .eq("operator_id", operatorId)
          .eq("platform", platformName);

        if ((count ?? 0) > 0) {
          const { error: rulesError } = await supabase
            .from("transaction_rules")
            .update({ is_active: true })
            .eq("operator_id", operatorId)
            .eq("platform", platformName);

          if (rulesError) throw new Error(rulesError.message);
        } else {
          const { error: rulesError } = await supabase
            .from("transaction_rules")
            .insert(
              DEFAULT_PLATFORM_RULES.map((rule) => ({
                ...rule,
                operator_id: operatorId,
                platform: platformName,
                is_active: true,
              }))
            );

          if (rulesError) throw new Error(rulesError.message);
        }

        showSuccess(`${platformName} restored`);
      } else {
        const { data: createdPlatform, error: platformError } = await supabase
          .from("operator_platforms")
          .insert({
            operator_id: operatorId,
            name: platformName,
            is_builtin: false,
            is_active: true,
          })
          .select("id")
          .single();

        if (platformError || !createdPlatform) {
          throw new Error(platformError?.message ?? "Failed to create platform");
        }

        const { data: createdWallet, error: walletError } = await supabase
          .from("wallets")
          .insert({
            operator_id: operatorId,
            wallet_type: "platform",
            wallet_name: platformName,
            balance,
            color: getDefaultWalletColor(platformName),
            is_active: true,
          })
          .select("id")
          .single();

        if (walletError || !createdWallet) {
          await supabase
            .from("operator_platforms")
            .update({ is_active: false })
            .eq("id", createdPlatform.id);
          throw new Error(walletError?.message ?? "Failed to create wallet");
        }

        const { error: rulesError } = await supabase
          .from("transaction_rules")
          .insert(
            DEFAULT_PLATFORM_RULES.map((rule) => ({
              ...rule,
              operator_id: operatorId,
              platform: platformName,
              is_active: true,
            }))
          );

        if (rulesError) {
          await supabase
            .from("wallets")
            .update({ is_active: false, balance: 0 })
            .eq("id", createdWallet.id);
          await supabase
            .from("operator_platforms")
            .update({ is_active: false })
            .eq("id", createdPlatform.id);
          throw new Error(rulesError.message);
        }

        showSuccess(`${platformName} added`);
      }

      setShowAdd(false);
      setNewName("");
      setNewBalance("");
      setDataLoading(true);

      const [platformsRes, walletsRes] = await Promise.all([
        supabase
          .from("operator_platforms")
          .select("id, name, is_builtin, is_active")
          .eq("operator_id", operatorId),
        supabase
          .from("wallets")
          .select("id, wallet_name, wallet_type, balance, is_active")
          .eq("operator_id", operatorId),
      ]);

      const wallets = (walletsRes.data ?? []) as WalletRow[];
      const walletByName = new Map(
        wallets.map((wallet) => [wallet.wallet_name.toLowerCase(), wallet])
      );

      setPlatforms(
        ((platformsRes.data ?? []) as Array<{
          id: string;
          name: string;
          is_builtin: boolean;
          is_active: boolean;
        }>)
          .map((platform) => {
            const wallet = walletByName.get(platform.name.toLowerCase()) ?? null;
            return {
              ...platform,
              walletId: wallet?.id ?? null,
              balance: wallet?.balance ?? 0,
            };
          })
          .sort((a, b) => comparePlatformNames(a.name, b.name))
      );
      setCashWallet(wallets.find((wallet) => wallet.wallet_name === "Cash" && wallet.is_active) ?? null);
      setDataLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save platform");
      setAdding(false);
      return;
    }

    setAdding(false);
  }

  async function deletePlatform(platform: OperatorPlatform) {
    if (!operatorId) return;

    if (platform.balance > 0) {
      setError("Set the wallet balance to 0 before removing this platform");
      return;
    }

    setDeletingId(platform.id);
    setError(null);

    const { count: pendingCount } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("operator_id", operatorId)
      .eq("platform", platform.name)
      .eq("status", "awaiting_confirm");

    if ((pendingCount ?? 0) > 0) {
      setDeletingId(null);
      setError("Review all pending transactions for this platform before removing it");
      return;
    }

    const { error: platformError } = await supabase
      .from("operator_platforms")
      .update({ is_active: false })
      .eq("id", platform.id);

    if (platformError) {
      setDeletingId(null);
      setError(platformError.message);
      return;
    }

    if (platform.walletId) {
      const { error: walletError } = await supabase
        .from("wallets")
        .update({ is_active: false })
        .eq("id", platform.walletId);

      if (walletError) {
        setDeletingId(null);
        setError(walletError.message);
        return;
      }
    }

    const { error: rulesError } = await supabase
      .from("transaction_rules")
      .update({ is_active: false })
      .eq("operator_id", operatorId)
      .eq("platform", platform.name);

    setDeletingId(null);

    if (rulesError) {
      setError(rulesError.message);
      return;
    }

    setPlatforms((prev) =>
      prev.map((row) =>
        row.id === platform.id ? { ...row, is_active: false } : row
      )
    );
    showSuccess(`${platform.name} removed`);
  }

  if (authLoading || dataLoading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  const activePlatforms = platforms.filter((platform) => platform.is_active);

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground max-w-[390px] mx-auto">
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
        {successMsg && (
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5">
            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <p className="text-sm text-emerald-400 font-medium">{successMsg}</p>
          </div>
        )}

        {activePlatforms.map((platform) => {
          const isDeleting = deletingId === platform.id;

          return (
            <div
              key={platform.id}
              className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.06] rounded-2xl px-4 py-3.5"
            >
              <div className="w-9 h-9 rounded-xl bg-white/[0.08] flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-4 h-4 text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{platform.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {platform.is_builtin ? "Built-in" : `Custom platform · ₱${platform.balance.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </p>
              </div>

              {!platform.is_builtin && (
                <button
                  onClick={() => void deletePlatform(platform)}
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

        {showAdd ? (
          <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Platform name
              </Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. ShopeePay"
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
                onClick={() => void addPlatform()}
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

        {!showAdd && error && (
          <div className="flex items-center gap-2 text-xs text-red-400">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/50 text-center pt-4 leading-relaxed">
          Built-in platforms stay active. Custom platforms can only be removed when their balance is 0
          and nothing is waiting for review.
        </p>
      </section>
    </div>
  );
}
