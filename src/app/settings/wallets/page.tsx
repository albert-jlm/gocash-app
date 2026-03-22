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

// ---------------------------------------------------------------------------
// Color palette — full static class strings so Tailwind JIT never purges them
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
  { id: "blue",    label: "Blue",    gradient: "from-blue-500 via-blue-600 to-blue-700",       swatch: "bg-blue-500",    accent: "text-blue-400" },
  { id: "purple",  label: "Purple",  gradient: "from-purple-500 via-purple-600 to-purple-700", swatch: "bg-purple-500",  accent: "text-purple-400" },
  { id: "emerald", label: "Green",   gradient: "from-emerald-500 via-emerald-600 to-emerald-700", swatch: "bg-emerald-500", accent: "text-emerald-400" },
  { id: "rose",    label: "Red",     gradient: "from-rose-500 via-rose-600 to-rose-700",       swatch: "bg-rose-500",    accent: "text-rose-400" },
  { id: "orange",  label: "Orange",  gradient: "from-orange-500 via-orange-600 to-orange-700", swatch: "bg-orange-500",  accent: "text-orange-400" },
  { id: "amber",   label: "Amber",   gradient: "from-amber-500 via-amber-600 to-amber-700",    swatch: "bg-amber-500",   accent: "text-amber-400" },
  { id: "cyan",    label: "Cyan",    gradient: "from-cyan-500 via-cyan-600 to-cyan-700",       swatch: "bg-cyan-500",    accent: "text-cyan-400" },
  { id: "zinc",    label: "Gray",    gradient: "from-zinc-600 via-zinc-700 to-zinc-800",       swatch: "bg-zinc-500",    accent: "text-zinc-400" },
] as const;

type ColorId = typeof COLOR_PALETTE[number]["id"];

function getColor(id: string) {
  return COLOR_PALETTE.find((c) => c.id === id) ?? COLOR_PALETTE[COLOR_PALETTE.length - 1];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Wallet {
  id: string;
  wallet_name: string;
  wallet_type: string;
  balance: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBalance(n: number): string {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WalletsSettingsPage() {
  const { operatorId, loading: authLoading } = useAuthGuard();

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  // Color picker state
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
        .order("wallet_type");
      // Cast needed until Supabase types are regenerated with the color column
      if (data) setWallets(data as unknown as Wallet[]);
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

  async function saveColor(walletId: string, colorId: ColorId) {
    setSavingColor(walletId);

    // Optimistic update
    setWallets((prev) =>
      prev.map((w) => (w.id === walletId ? { ...w, color: colorId } : w))
    );
    setColorPickerOpenId(null);

    const { error: updateError } = await supabase
      .from("wallets")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ color: colorId } as any)
      .eq("id", walletId);

    setSavingColor(null);

    if (updateError) {
      // Revert on failure
      setWallets((prev) =>
        prev.map((w) => (w.id === walletId ? { ...w, color: w.color } : w))
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
          <p className="text-xs text-muted-foreground">View, adjust balances and customise colours</p>
        </div>
      </header>

      {/* Wallet List */}
      <section className="px-5 flex-1 space-y-3 pb-10">
        {wallets.map((w) => {
          const color = getColor(w.color);
          const isEditing = editingId === w.id;
          const justSaved = successId === w.id;
          const isColorOpen = colorPickerOpenId === w.id;

          return (
            <div key={w.id} className="rounded-2xl overflow-hidden">
              {/* Card header — gradient from chosen color */}
              <div className={`relative bg-gradient-to-br ${color.gradient} p-5 overflow-hidden`}>
                {/* Decorative blur */}
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
                    {/* Success indicator */}
                    {justSaved && (
                      <div className="flex items-center gap-1 bg-white/20 backdrop-blur-sm rounded-full px-2.5 py-1">
                        <Check className="w-3 h-3 text-white" />
                        <span className="text-[11px] text-white font-medium">Saved</span>
                      </div>
                    )}
                    {/* Color picker toggle */}
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

              {/* Color picker — slides open */}
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

              {/* Adjustment section */}
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
