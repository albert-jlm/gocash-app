"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  CreditCard,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  comparePlatformNames,
  DEFAULT_PLATFORM_RULE_TEMPLATES,
  getDefaultWalletColor,
  isBuiltInPlatform,
  isMissingOperatorPlatformsError,
} from "@/lib/platforms";
import { supabase } from "@/lib/supabase/client";

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

interface DeletePlatformResult {
  success: boolean;
  code?: string;
  message?: string;
  platform?: string;
  wallet_balance?: number;
  transaction_count?: number;
  rule_count?: number;
}

function formatPeso(value: number): string {
  return value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PlatformsPanel({
  operatorId,
  userId,
  restorePlatformName,
  onRestoreHandled,
}: {
  operatorId: string;
  userId: string | null;
  restorePlatformName?: string | null;
  onRestoreHandled?: () => void;
}) {
  const [platforms, setPlatforms] = useState<OperatorPlatform[]>([]);
  const [cashWallet, setCashWallet] = useState<WalletRow | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [supportsOperatorPlatforms, setSupportsOperatorPlatforms] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OperatorPlatform | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteFeedback, setDeleteFeedback] = useState<DeletePlatformResult | null>(null);

  const refreshData = useCallback(async () => {
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
    const walletByName = new Map(wallets.map((wallet) => [wallet.wallet_name.toLowerCase(), wallet]));

    if (platformsRes.error && isMissingOperatorPlatformsError(platformsRes.error.message)) {
      setSupportsOperatorPlatforms(false);
      setPlatforms(
        wallets
          .filter((wallet) => wallet.wallet_type === "platform")
          .map((wallet) => ({
            id: wallet.id,
            name: wallet.wallet_name,
            is_builtin: isBuiltInPlatform(wallet.wallet_name),
            is_active: wallet.is_active,
            walletId: wallet.id,
            balance: wallet.balance,
          }))
          .sort((a, b) => comparePlatformNames(a.name, b.name))
      );
      setCashWallet(wallets.find((wallet) => wallet.wallet_name === "Cash" && wallet.is_active) ?? null);
      setDataLoading(false);
      return;
    }

    setSupportsOperatorPlatforms(true);
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
  }, [operatorId]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!restorePlatformName) return;

    setShowAdd(true);
    setNewName(restorePlatformName);
    setNewBalance((current) => current || "0");
    setError(null);
  }, [restorePlatformName]);

  function showSuccess(message: string) {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(null), 2500);
  }

  async function addPlatform() {
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

    const balance = parseFloat(newBalance) || 0;
    const platformName = existing?.name ?? trimmed;

    setAdding(true);
    setError(null);

    try {
      if (!supportsOperatorPlatforms) {
        setError("Please apply the latest database migration before managing platforms here.");
        setAdding(false);
        return;
      }

      if (existing) {
        const { error: reactivatePlatformError } = await supabase
          .from("operator_platforms")
          .update({
            is_active: true,
            is_builtin: isBuiltInPlatform(platformName),
          })
          .eq("id", existing.id);

        if (reactivatePlatformError) {
          throw new Error(reactivatePlatformError.message);
        }
      } else {
        const { error: platformError } = await supabase
          .from("operator_platforms")
          .insert({
            operator_id: operatorId,
            name: platformName,
            is_builtin: isBuiltInPlatform(platformName),
            is_active: true,
          });

        if (platformError) {
          throw new Error(platformError.message);
        }
      }

      const { error: walletError } = await supabase
        .from("wallets")
        .upsert(
          {
            operator_id: operatorId,
            wallet_type: "platform",
            wallet_name: platformName,
            balance,
            color: getDefaultWalletColor(platformName),
            is_active: true,
          },
          { onConflict: "operator_id,wallet_name" }
        );

      if (walletError) {
        throw new Error(walletError.message);
      }

      const { data: existingRules, error: existingRulesError } = await supabase
        .from("transaction_rules")
        .select("id")
        .eq("operator_id", operatorId)
        .eq("platform", platformName);

      if (existingRulesError) {
        throw new Error(existingRulesError.message);
      }

      if ((existingRules ?? []).length > 0) {
        const { error: reenableRulesError } = await supabase
          .from("transaction_rules")
          .update({ is_active: true })
          .eq("operator_id", operatorId)
          .eq("platform", platformName);

        if (reenableRulesError) {
          throw new Error(reenableRulesError.message);
        }
      } else {
        const { error: rulesError } = await supabase
          .from("transaction_rules")
          .insert(
            DEFAULT_PLATFORM_RULE_TEMPLATES.map((rule) => ({
              ...rule,
              operator_id: operatorId,
              platform: platformName,
              is_active: true,
            }))
          );

        if (rulesError) {
          throw new Error(rulesError.message);
        }
      }

      await refreshData();
      setShowAdd(false);
      setNewName("");
      setNewBalance("");

      const restoredFromCapture =
        restorePlatformName &&
        restorePlatformName.toLowerCase() === platformName.toLowerCase();

      showSuccess(
        restoredFromCapture
          ? `${platformName} is active again. You can retry your screenshot now.`
          : `${platformName} added`
      );

      if (restoredFromCapture) {
        onRestoreHandled?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save platform");
    } finally {
      setAdding(false);
    }
  }

  async function confirmDeletePlatform() {
    if (!deleteTarget) return;
    if (!supportsOperatorPlatforms) {
      setDeleteFeedback({
        success: false,
        message: "Please apply the latest database migration before deleting platforms here.",
      });
      return;
    }
    if (!userId) {
      setDeleteFeedback({ success: false, message: "Your session expired. Please sign in again." });
      return;
    }

    setDeleteSubmitting(true);
    setDeleteFeedback(null);

    const { data, error: rpcError } = await supabase.rpc("delete_platform_atomic", {
      p_operator_id: operatorId,
      p_platform_name: deleteTarget.name,
      p_user_id: userId,
    });

    setDeleteSubmitting(false);

    if (rpcError) {
      setDeleteFeedback({
        success: false,
        message: rpcError.message,
      });
      return;
    }

    const result = data as DeletePlatformResult | null;
    if (!result?.success) {
      setDeleteFeedback(result ?? { success: false, message: "Failed to delete platform" });
      return;
    }

    setPlatforms((prev) => prev.filter((platform) => platform.id !== deleteTarget.id));
    setDeleteTarget(null);
    setDeleteFeedback(null);
    showSuccess(`${result.platform ?? deleteTarget.name} deleted`);
  }

  if (dataLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
      </div>
    );
  }

  const activePlatforms = platforms.filter((platform) => platform.is_active);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Platforms</h2>
        <p className="text-xs text-muted-foreground">
          Delete built-in or custom platforms safely. Cash remains protected as your register.
        </p>
      </div>

      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5">
          <Check className="h-4 w-4 flex-shrink-0 text-emerald-400" />
          <p className="text-sm font-medium text-emerald-400">{successMsg}</p>
        </div>
      )}

      {restorePlatformName && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-semibold text-amber-300">Restore detected platform</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
            The last scanned receipt needs <span className="font-semibold">{restorePlatformName}</span>.
            Re-add it here, then retry the screenshot.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {activePlatforms.map((platform) => {
          const isDeleting = deleteTarget?.id === platform.id && deleteSubmitting;

          return (
            <div
              key={platform.id}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3.5"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.08]">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{platform.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {platform.is_builtin ? "Built-in platform" : "Custom platform"} · ₱
                  {formatPeso(platform.balance)}
                </p>
              </div>

              <button
                onClick={() => {
                  setDeleteTarget(platform);
                  setDeleteFeedback(null);
                  setError(null);
                }}
                disabled={isDeleting}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                title={`Delete ${platform.name}`}
              >
                {isDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-red-400" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {cashWallet && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3.5">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/15">
            <CreditCard className="h-4 w-4 text-emerald-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Cash Register</p>
            <p className="text-[11px] text-muted-foreground">
              Protected · ₱{formatPeso(cashWallet.balance)}
            </p>
          </div>
        </div>
      )}

      {showAdd ? (
        <div className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Platform name
            </Label>
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="e.g. ShopeePay"
              autoFocus
              className="h-10 rounded-xl border-white/[0.1] bg-white/[0.07] text-sm"
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
              onChange={(event) => setNewBalance(event.target.value)}
              placeholder="0"
              className="h-10 rounded-xl border-white/[0.1] bg-white/[0.07] text-sm tabular-nums"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => void addPlatform()}
              disabled={adding}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {restorePlatformName ? "Re-add Platform" : "Add Platform"}
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setError(null);
                setNewName("");
                setNewBalance("");
                onRestoreHandled?.();
              }}
              className="rounded-xl bg-white/[0.07] px-4 py-2.5 text-sm font-medium text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setShowAdd(true);
            setError(null);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.04] py-3.5 text-sm text-muted-foreground transition-colors hover:bg-white/[0.06]"
        >
          <Plus className="h-4 w-4" />
          Add a new platform
        </button>
      )}

      {!showAdd && error && (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground/50">
        Deleting a platform permanently removes its wallet and rules only after the balance is zero and no
        transactions still reference it.
      </p>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-5 pb-6 pt-10 sm:items-center">
          <div className="w-full max-w-md rounded-3xl border border-white/[0.08] bg-background p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl bg-red-500/10 p-3">
                <Trash2 className="h-5 w-5 text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold">Delete {deleteTarget.name}?</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  This permanently removes the platform record, wallet, and related profit rules if cleanup
                  checks pass. Cash stays protected and is not affected.
                </p>
              </div>
            </div>

            {deleteFeedback?.code === "dependencies_exist" && (
              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm">
                <p className="font-semibold text-amber-300">Cleanup required before deletion</p>
                <div className="mt-2 space-y-1 text-amber-100/80">
                  <p>Wallet balance: ₱{formatPeso(deleteFeedback.wallet_balance ?? 0)}</p>
                  <p>Transactions still linked: {deleteFeedback.transaction_count ?? 0}</p>
                  <p>Rules that would be removed: {deleteFeedback.rule_count ?? 0}</p>
                </div>
              </div>
            )}

            {deleteFeedback?.message && deleteFeedback.code !== "dependencies_exist" && (
              <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>{deleteFeedback.message}</p>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteFeedback(null);
                }}
                className="flex-1 rounded-2xl bg-white/[0.07] px-4 py-3 text-sm font-medium text-muted-foreground"
              >
                Close
              </button>
              <button
                onClick={() => void confirmDeletePlatform()}
                disabled={deleteSubmitting}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-red-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-400 active:bg-red-600 disabled:opacity-50"
              >
                {deleteSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete Platform
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
