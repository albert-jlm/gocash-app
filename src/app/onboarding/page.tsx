"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronRight, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase/client";
import { provisionOperator } from "@/lib/ledger";
import { parsePesosInput } from "@core/money.ts";
import type { Session } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Signing up is now ONE server-side call.
//
// This screen used to do it in three client statements: insert an operator,
// upsert three `wallets` rows carrying their balances, then seed six
// `transaction_rules` rows. All three are gone.
//
//   - `wallets` and `transaction_rules` are being dropped.
//   - An opening balance is a posted ledger entry, not a column, and the
//     ledger grants the browser SELECT only.
//   - Direction is no longer data (see `@core/postings.ts`), and default
//     pricing is seeded as `fee_rules` by the same provisioning call.
//
// `gocash.provision_operator()` does the whole thing in one transaction,
// including the `revenue` and `equity` accounts that are not optional: a fee
// has nowhere to go without revenue, and an opening balance or a drawer-count
// correction has no second leg without equity.
// ---------------------------------------------------------------------------

/** Platform accounts a new operator starts with. */
const DEFAULT_PLATFORMS = ["GCash", "MariBank", "Maya"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // Step 1 fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  // Step 2 fields
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
        // If they already have an operator record, skip onboarding
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

    // Blank means zero; anything else must read exactly. parseFloat took a
    // typed "20,000" as 20 and opened the books at a thousandth of the float.
    const opening: Record<string, number> = {};
    for (const [label, text] of [
      ["GCash", gcashBalance], ["Maya", mayaBalance], ["MariBank", maribankBalance],
      ["Cash", cashBalance],
    ] as const) {
      const minor = text.trim() === "" ? 0 : parsePesosInput(text);
      if (minor === null) {
        setError(`The ${label} balance isn't a readable amount. Use digits like 20000 or 20,000.50.`);
        return;
      }
      opening[label] = minor;
    }

    setSaving(true);

    try {
      // One call, one transaction: the operator, their chart of accounts, the
      // platform accounts, default fee rules and the opening entry.
      //
      // Opening balances are sent in CENTAVOS, which is the unit the ledger and
      // `@core/money.ts` work in end to end. A fractional value is rejected
      // server-side rather than rounded, because a caller sending pesos would
      // otherwise book 1/100th of the intended balance.
      await provisionOperator({
        userId: session.user.id,
        name: name.trim(),
        email: session.user.email ?? "",
        phone: phone.trim() || null,
        platforms: DEFAULT_PLATFORMS,
        openingMinor: {
          GCash: opening.GCash,
          Maya: opening.Maya,
          MariBank: opening.MariBank,
          Cash: opening.Cash,
        },
      });

      router.replace("/");
    } catch (err) {
      // Already set up (a second tap, or arriving here by mistake): that is
      // the state this screen exists to reach, so go to the app.
      if ((err as { code?: string }).code === "ALREADY_PROVISIONED") {
        router.replace("/");
        return;
      }
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
    <div className="flex flex-col min-h-screen bg-background text-foreground max-w-[430px] mx-auto px-5 sm:justify-center sm:pb-10">
      {/* Progress dots */}
      <div className="flex items-center justify-center gap-2 pt-14 lg:pt-10 pb-8">
        <span className={`w-2 h-2 rounded-full ${step === 1 ? "bg-emerald-400" : "bg-emerald-400/40"}`} />
        <span className={`w-2 h-2 rounded-full ${step === 2 ? "bg-emerald-400" : "bg-white/20"}`} />
      </div>

      {step === 1 ? (
        /* ── Step 1: Your details ── */
        <div className="flex-1 sm:flex-none flex flex-col">
          <div className="mb-8">
            <h1 className="text-2xl font-bold mb-2">Welcome!</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Let&apos;s set up your account. This takes less than a minute.
            </p>
          </div>

          <div className="space-y-4 flex-1 sm:flex-none sm:mb-8">
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
        /* ── Step 2: Opening balances ── */
        <div className="flex-1 sm:flex-none flex flex-col">
          <div className="mb-8">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 flex items-center justify-center mb-4">
              <Wallet className="w-6 h-6 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Your current balances</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Enter how much you have right now in each wallet. You can always adjust these later.
            </p>
          </div>

          <div className="space-y-4 flex-1 sm:flex-none sm:mb-8">
            {[
              { label: "GCash wallet", value: gcashBalance, onChange: setGcashBalance, color: "text-blue-400" },
              { label: "Maya wallet", value: mayaBalance, onChange: setMayaBalance, color: "text-green-400" },
              { label: "MariBank wallet", value: maribankBalance, onChange: setMaribankBalance, color: "text-purple-400" },
              { label: "Cash on hand", value: cashBalance, onChange: setCashBalance, color: "text-emerald-400" },
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
              Not sure? Enter 0 for now and set it in Settings → Wallets.
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
