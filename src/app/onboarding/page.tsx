"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronRight, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { BUILTIN_PLATFORM_NAMES, getDefaultWalletColor } from "@/lib/platforms";

const DEFAULT_RULES = [
  { transaction_type: "Cash In",         platform: "all", delta_platform_mult: 1,  delta_cash_amount_mult: -1, delta_cash_mult: 1, profit_rate: 2,    profit_minimum: 5  },
  { transaction_type: "Cash Out",        platform: "all", delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 1, profit_rate: 2,    profit_minimum: 5  },
  { transaction_type: "Telco Load",      platform: "all", delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 1, profit_rate: 3,    profit_minimum: 3  },
  { transaction_type: "Bills Payment",   platform: "all", delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 0, profit_rate: 0,    profit_minimum: 5  },
  { transaction_type: "Bank Transfer",   platform: "all", delta_platform_mult: -1, delta_cash_amount_mult: 1,  delta_cash_mult: 0, profit_rate: 0,    profit_minimum: 5  },
  { transaction_type: "Profit Remittance", platform: "all", delta_platform_mult: 0, delta_cash_amount_mult: -1, delta_cash_mult: 0, profit_rate: null, profit_minimum: null },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [gcashBalance, setGcashBalance] = useState("");
  const [maribankBalance, setMaribankBalance] = useState("");
  const [mayaBalance, setMayaBalance] = useState("");
  const [cashBalance, setCashBalance] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!s) {
        router.replace("/login");
      } else {
        supabase
          .from("operators")
          .select("id")
          .eq("user_id", s.user.id)
          .maybeSingle()
          .then(({ data }) => {
            if (data) {
              router.replace("/");
            } else {
              setSession(s);
              setCheckingSession(false);
            }
          });
      }
    });
  }, [router]);

  async function handleFinish() {
    if (!session) return;
    setError(null);
    setSaving(true);

    try {
      let operatorId: string;

      const { data: existing } = await supabase
        .from("operators")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (existing) {
        operatorId = existing.id;
      } else {
        const { data: op, error: opError } = await supabase
          .from("operators")
          .insert({
            user_id: session.user.id,
            email: session.user.email ?? "",
            name: name.trim(),
            phone: phone.trim() || null,
            subscription_tier: "free",
            is_active: true,
            settings: {},
          })
          .select("id")
          .single();

        if (opError || !op) {
          throw new Error(opError?.message ?? "Could not create your account");
        }
        operatorId = op.id;
      }

      const { data: existingPlatforms } = await supabase
        .from("operator_platforms")
        .select("name")
        .eq("operator_id", operatorId);

      const existingPlatformNames = new Set(
        (existingPlatforms ?? []).map((platform) => platform.name.toLowerCase())
      );

      const missingPlatforms = BUILTIN_PLATFORM_NAMES
        .filter((name) => !existingPlatformNames.has(name.toLowerCase()))
        .map((name) => ({
          operator_id: operatorId,
          name,
          is_builtin: true,
          is_active: true,
        }));

      if (missingPlatforms.length > 0) {
        const { error: platformError } = await supabase
          .from("operator_platforms")
          .insert(missingPlatforms);

        if (platformError) throw new Error(platformError.message);
      }

      const { error: walletError } = await supabase.from("wallets").upsert(
        [
          {
            operator_id: operatorId,
            wallet_type: "platform",
            wallet_name: "GCash",
            balance: parseFloat(gcashBalance) || 0,
            color: getDefaultWalletColor("GCash"),
            is_active: true,
          },
          {
            operator_id: operatorId,
            wallet_type: "platform",
            wallet_name: "MariBank",
            balance: parseFloat(maribankBalance) || 0,
            color: getDefaultWalletColor("MariBank"),
            is_active: true,
          },
          {
            operator_id: operatorId,
            wallet_type: "platform",
            wallet_name: "Maya",
            balance: parseFloat(mayaBalance) || 0,
            color: getDefaultWalletColor("Maya"),
            is_active: true,
          },
          {
            operator_id: operatorId,
            wallet_type: "cash",
            wallet_name: "Cash",
            balance: parseFloat(cashBalance) || 0,
            color: getDefaultWalletColor("Cash"),
            is_active: true,
          },
        ],
        { onConflict: "operator_id,wallet_name" }
      );

      if (walletError) throw new Error(walletError.message);

      const { count } = await supabase
        .from("transaction_rules")
        .select("id", { count: "exact", head: true })
        .eq("operator_id", operatorId);

      if (!count || count === 0) {
        const { error: rulesError } = await supabase
          .from("transaction_rules")
          .insert(DEFAULT_RULES.map((r) => ({ ...r, operator_id: operatorId, is_active: true })));

        if (rulesError) throw new Error(rulesError.message);
      }

      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-background px-5 text-foreground sm:px-6">
      <div className="flex items-center justify-center gap-2 pt-14 pb-8">
        <span className={`w-2 h-2 rounded-full ${step === 1 ? "bg-emerald-400" : "bg-emerald-400/40"}`} />
        <span className={`w-2 h-2 rounded-full ${step === 2 ? "bg-emerald-400" : "bg-white/20"}`} />
      </div>

      {step === 1 ? (
        <div className="flex-1 flex flex-col">
          <div className="mb-8">
            <h1 className="text-2xl font-bold mb-2">Welcome!</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Let&apos;s set up your account. This takes less than a minute.
            </p>
          </div>

          <div className="space-y-4 flex-1">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Your name
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Maria Santos"
                autoFocus
                className="bg-white/[0.07] border-white/[0.1] h-12 rounded-xl text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Phone number{" "}
                <span className="normal-case tracking-normal font-normal text-muted-foreground/60">
                  (optional)
                </span>
              </Label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="09XX XXX XXXX"
                className="bg-white/[0.07] border-white/[0.1] h-12 rounded-xl text-sm"
              />
            </div>
          </div>

          <div className="py-8">
            <button
              onClick={() => setStep(2)}
              disabled={!name.trim()}
              className="w-full flex items-center justify-center gap-2 bg-emerald-500 disabled:opacity-50 text-white font-semibold py-4 rounded-2xl text-[15px]"
            >
              Next
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <div className="mb-8">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 flex items-center justify-center mb-4">
              <Wallet className="w-6 h-6 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Your current balances</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Enter how much you have right now in each wallet. You can always adjust these later.
            </p>
          </div>

          <div className="space-y-4 flex-1">
            {[
              { label: "GCash wallet", value: gcashBalance, onChange: setGcashBalance, color: "text-blue-400" },
              { label: "MariBank wallet", value: maribankBalance, onChange: setMaribankBalance, color: "text-orange-400" },
              { label: "Maya wallet", value: mayaBalance, onChange: setMayaBalance, color: "text-emerald-400" },
              { label: "Cash on hand", value: cashBalance, onChange: setCashBalance, color: "text-rose-400" },
            ].map(({ label, value, onChange, color }) => (
              <div key={label} className="space-y-1.5">
                <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {label}
                </Label>
                <div className="relative">
                  <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none ${color}`}>
                    ₱
                  </span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="0.00"
                    className="bg-white/[0.07] border-white/[0.1] h-12 rounded-xl pl-7 text-sm tabular-nums"
                  />
                </div>
              </div>
            ))}

            <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
              Not sure? Enter 0 for now and update it in Settings → Wallets.
            </p>
          </div>

          {error && (
            <p className="text-xs text-red-400 px-1 pb-2">{error}</p>
          )}

          <div className="py-8 space-y-3">
            <button
              onClick={handleFinish}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-emerald-500 disabled:opacity-60 text-white font-semibold py-4 rounded-2xl text-[15px]"
            >
              {saving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Setting up...
                </>
              ) : (
                "Start Tracking"
              )}
            </button>
            <button
              onClick={() => setStep(1)}
              className="w-full text-sm text-muted-foreground py-2"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
