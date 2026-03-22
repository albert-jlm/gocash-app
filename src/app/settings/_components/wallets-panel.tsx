"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, CreditCard, Loader2, Palette } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COLOR_PALETTE,
  getWalletColor,
  sortWallets,
  type WalletColorId,
} from "@/lib/platforms";
import { supabase } from "@/lib/supabase/client";

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

export function WalletsPanel({ operatorId }: { operatorId: string }) {
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
    let isMounted = true;

    async function fetchWallets() {
      const { data } = await supabase
        .from("wallets")
        .select("id, wallet_name, wallet_type, balance, color")
        .eq("operator_id", operatorId)
        .eq("is_active", true);

      if (!isMounted) return;

      if (data) setWallets(sortWallets(data as unknown as Wallet[]));
      setDataLoading(false);
    }

    void fetchWallets();

    return () => {
      isMounted = false;
    };
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
      prev.map((wallet) => (wallet.id === walletId ? { ...wallet, balance: newBalance } : wallet))
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
      prev.map((wallet) => (wallet.id === walletId ? { ...wallet, color: colorId } : wallet))
    );
    setColorPickerOpenId(null);

    const { error: updateError } = await supabase
      .from("wallets")
      .update({ color: colorId })
      .eq("id", walletId);

    setSavingColor(null);

    if (updateError) {
      setWallets((prev) =>
        prev.map((wallet) =>
          wallet.id === walletId && previousColor
            ? { ...wallet, color: previousColor }
            : wallet
        )
      );
    }
  }

  if (dataLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
      </div>
    );
  }

  const platformWallets = wallets.filter((wallet) => wallet.wallet_type === "platform");
  const registerWallets = wallets.filter((wallet) => wallet.wallet_type !== "platform");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Wallets</h2>
        <p className="text-xs text-muted-foreground">Adjust balances and colors in one place.</p>
      </div>

      <div className="space-y-3">
        {platformWallets.map((wallet) => {
          const color = getWalletColor(wallet.color);
          const isEditing = editingId === wallet.id;
          const justSaved = successId === wallet.id;
          const isColorOpen = colorPickerOpenId === wallet.id;

          return (
            <div key={wallet.id} className="overflow-hidden rounded-2xl">
              <div className={`relative overflow-hidden bg-gradient-to-br ${color.gradient} p-5`}>
                <div className="pointer-events-none absolute right-0 top-0 h-28 w-28 translate-x-8 -translate-y-8 rounded-full bg-white/10 blur-2xl" />

                <div className="relative z-10 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                      <CreditCard className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-white/70">{wallet.wallet_name}</p>
                      <p className="text-[22px] font-bold leading-tight tracking-tight text-white tabular-nums">
                        {formatBalance(wallet.balance)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {justSaved && (
                      <div className="flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 backdrop-blur-sm">
                        <Check className="h-3 w-3 text-white" />
                        <span className="text-[11px] font-medium text-white">Saved</span>
                      </div>
                    )}
                    <button
                      onClick={() => setColorPickerOpenId(isColorOpen ? null : wallet.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm"
                      title="Change color"
                    >
                      {savingColor === wallet.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                      ) : (
                        <Palette className="h-3.5 w-3.5 text-white" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {isColorOpen && (
                <div className="border-x border-white/[0.05] bg-white/[0.06] px-4 py-3">
                  <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Choose color
                  </p>
                  <div className="grid grid-cols-8 gap-2">
                    {COLOR_PALETTE.map((paletteColor) => (
                      <button
                        key={paletteColor.id}
                        onClick={() => saveColor(wallet.id, paletteColor.id)}
                        title={paletteColor.label}
                        className={[
                          "h-7 w-7 rounded-full transition-all",
                          paletteColor.swatch,
                          wallet.color === paletteColor.id
                            ? "scale-110 ring-2 ring-white ring-offset-1 ring-offset-transparent"
                            : "opacity-70 hover:scale-105 hover:opacity-100",
                        ].join(" ")}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-b-2xl border border-t-0 border-white/[0.05] bg-white/[0.04]">
                {isEditing ? (
                  <div className="space-y-3 p-4">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        New balance
                      </Label>
                      <div className="relative">
                        <span className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm ${color.accent}`}>
                          ₱
                        </span>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={editValue}
                          onChange={(event) => setEditValue(event.target.value)}
                          autoFocus
                          className="h-11 rounded-xl border-white/[0.1] bg-white/[0.07] pl-7 text-sm tabular-nums"
                        />
                      </div>
                    </div>

                    {error && (
                      <div className="flex items-center gap-2 text-xs text-red-400">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        {error}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => saveBalance(wallet.id)}
                        disabled={saving}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Update
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-xl bg-white/[0.07] px-4 py-2.5 text-sm font-medium text-muted-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => startEdit(wallet)}
                    className="w-full px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-white/[0.03]"
                  >
                    Set balance manually →
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Register</h3>
          <p className="text-xs text-muted-foreground">Cash always stays active and is treated as the register.</p>
        </div>

        {registerWallets.map((wallet) => {
          const color = getWalletColor(wallet.color);
          const isEditing = editingId === wallet.id;
          const justSaved = successId === wallet.id;

          return (
            <div
              key={wallet.id}
              className={`overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br ${color.gradient}`}
            >
              <div className="flex items-center justify-between p-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-white/70">Cash Register</p>
                  <p className="text-2xl font-bold text-white tabular-nums">{formatBalance(wallet.balance)}</p>
                </div>
                {justSaved && (
                  <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-medium text-white">
                    Saved
                  </span>
                )}
              </div>

              <div className="border-t border-white/10 bg-black/10 px-4 py-3">
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-semibold uppercase tracking-widest text-white/70">
                        Register balance
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                        autoFocus
                        className="h-11 rounded-xl border-white/20 bg-white/10 text-sm text-white tabular-nums"
                      />
                    </div>

                    {error && (
                      <div className="flex items-center gap-2 text-xs text-red-200">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        {error}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => saveBalance(wallet.id)}
                        disabled={saving}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white py-2.5 text-sm font-semibold text-zinc-900 disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Update
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white/80"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => startEdit(wallet)}
                    className="w-full rounded-xl bg-white/10 px-4 py-3 text-left text-sm font-medium text-white/80 transition-colors hover:bg-white/15"
                  >
                    Adjust register balance →
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground/50">
        Manual adjustments are for correcting discrepancies only. Transaction-based changes still happen
        automatically.
      </p>
    </div>
  );
}
