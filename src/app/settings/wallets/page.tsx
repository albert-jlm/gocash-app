"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Loader2,
  CreditCard,
  Check,
  AlertCircle,
  Palette,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { supabase } from "@/lib/supabase/client";
import {
  COLOR_PALETTE,
  getWalletColor,
  sortWallets,
  type WalletColorId,
} from "@/lib/platforms";

interface Wallet {
  id: string;
  wallet_name: string;
  wallet_type: string;
  balance: number;
  color: string;
}

function formatBalance(n: number): string {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function WalletsSettingsPage() {
  const { operatorId, loading: authLoading } = useAuthGuard();

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  const [colorPickerOpenId, setColorPickerOpenId] = useState<string | null>(null);
  const [savingColor, setSavingColor] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId;
    async function fetchWallets() {
      const { data } = await supabase
        .from("wallets")
        .select("id, wallet_name, wallet_type, balance, color")
        .eq("operator_id", opId)
        .eq("is_active", true);
      if (data) setWallets(sortWallets(data as unknown as Wallet[]));
      setDataLoading(false);
    }
    fetchWallets();
  }, [operatorId]);

  function startEdit(wallet: Wallet) {
    setEditingId(wallet.id);
    setEditValue(wallet.balance.toString());
    setColorPickerOpenId(null);
    setError(null);
    setSuccessId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
    setError(null);
  }

  async function saveBalance(walletId: string) {
    const newBalance = parseFloat(editValue);
    if (isNaN(newBalance) || newBalance < 0) {
      setError("Enter a valid amount");
      return;
    }

    setSaving(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("wallets")
      .update({ balance: newBalance })
      .eq("id", walletId);

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setWallets((prev) =>
      prev.map((w) => (w.id === walletId ? { ...w, balance: newBalance } : w))
    );
    setEditingId(null);
    setEditValue("");
    setSuccessId(walletId);
    setTimeout(() => setSuccessId(null), 2000);
  }

  async function saveColor(walletId: string, colorId: WalletColorId) {
    setSavingColor(walletId);
    const previousColor = wallets.find((wallet) => wallet.id === walletId)?.color;

    setWallets((prev) =>
      prev.map((w) => (w.id === walletId ? { ...w, color: colorId } : w))
    );
    setColorPickerOpenId(null);

    const { error: updateError } = await supabase
      .from("wallets")
      .update({ color: colorId })
      .eq("id", walletId);

    setSavingColor(null);

    if (updateError) {
      setWallets((prev) =>
        prev.map((w) => (
          w.id === walletId && previousColor
            ? { ...w, color: previousColor }
            : w
        ))
      );
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
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link
          href="/settings"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <div>
          <h1 className="text-base font-semibold">Wallets</h1>
          <p className="text-xs text-muted-foreground">View, adjust balances and customise colours</p>
        </div>
      </header>

      <section className="px-5 flex-1 space-y-3 pb-10">
        {wallets.map((w) => {
          const color = getWalletColor(w.color);
          const isEditing = editingId === w.id;
          const justSaved = successId === w.id;
          const isColorOpen = colorPickerOpenId === w.id;

          return (
            <div key={w.id} className="rounded-2xl overflow-hidden">
              <div className={`relative bg-gradient-to-br ${color.gradient} p-5 overflow-hidden`}>
                <div className="absolute top-0 right-0 w-28 h-28 bg-white/10 rounded-full blur-2xl -translate-y-8 translate-x-8 pointer-events-none" />

                <div className="relative z-10 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
                      <CreditCard className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="text-white/70 text-xs font-medium">{w.wallet_name}</p>
                      <p className="text-white text-[22px] font-bold tracking-tight tabular-nums leading-tight">
                        {formatBalance(w.balance)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {justSaved && (
                      <div className="flex items-center gap-1 bg-white/20 backdrop-blur-sm rounded-full px-2.5 py-1">
                        <Check className="w-3 h-3 text-white" />
                        <span className="text-[11px] text-white font-medium">Saved</span>
                      </div>
                    )}
                    <button
                      onClick={() => setColorPickerOpenId(isColorOpen ? null : w.id)}
                      className="w-8 h-8 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center"
                      title="Change colour"
                    >
                      {savingColor === w.id
                        ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                        : <Palette className="w-3.5 h-3.5 text-white" />
                      }
                    </button>
                  </div>
                </div>
              </div>

              {isColorOpen && (
                <div className="bg-white/[0.06] border-x border-white/[0.05] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5">
                    Choose colour
                  </p>
                  <div className="grid grid-cols-8 gap-2">
                    {COLOR_PALETTE.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => saveColor(w.id, c.id)}
                        title={c.label}
                        className={[
                          "w-7 h-7 rounded-full transition-all",
                          c.swatch,
                          w.color === c.id
                            ? "ring-2 ring-white ring-offset-1 ring-offset-transparent scale-110"
                            : "opacity-70 hover:opacity-100 hover:scale-105",
                        ].join(" ")}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-white/[0.04] border border-white/[0.05] border-t-0 rounded-b-2xl">
                {isEditing ? (
                  <div className="p-4 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        New balance
                      </Label>
                      <div className="relative">
                        <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none ${color.accent}`}>
                          ₱
                        </span>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          autoFocus
                          className="bg-white/[0.07] border-white/[0.1] h-11 rounded-xl pl-7 text-sm tabular-nums"
                        />
                      </div>
                    </div>

                    {error && (
                      <div className="flex items-center gap-2 text-xs text-red-400">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        {error}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => saveBalance(w.id)}
                        disabled={saving}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Update
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="px-4 py-2.5 bg-white/[0.07] text-muted-foreground font-medium rounded-xl text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => startEdit(w)}
                    className="w-full px-4 py-3 text-left text-sm text-muted-foreground hover:bg-white/[0.03] transition-colors"
                  >
                    Set balance manually →
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <p className="text-[11px] text-muted-foreground/50 text-center pt-4 leading-relaxed">
          Manual adjustments are for correcting discrepancies only.
          Transaction-based changes happen automatically.
        </p>
      </section>
    </div>
  );
}
