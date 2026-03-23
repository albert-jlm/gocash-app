"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase/client";
import { getAuthRedirectUrl, resolveAuthDestination, startGoogleSignIn } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function syncAuth(session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]) {
      const { destination } = await resolveAuthDestination(session);
      if (cancelled) return;

      if (destination === "/login") {
        setCheckingSession(false);
        return;
      }

      router.replace(destination);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      void syncAuth(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        void syncAuth(session);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: getAuthRedirectUrl(),
      },
    });

    setLoading(false);

    if (otpError) {
      setError(otpError.message);
    } else {
      setSent(true);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    setLoading(false);

    if (verifyError) {
      setError(verifyError.message);
    }
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen bg-[#0a0a0a] items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-xl flex-col overflow-hidden bg-[#0a0a0a] px-5 text-foreground sm:px-6">
      <div
        className="absolute top-[15%] left-1/2 -translate-x-1/2 w-64 h-64 rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)",
        }}
      />

      <div className="flex-1 flex flex-col items-center justify-center pb-6 relative z-10">
        <div className="relative mb-6">
          <div className="w-[72px] h-[72px] rounded-[22px] bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-900/40">
            <span className="text-[28px] font-black text-white tracking-tight">G</span>
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#0a0a0a] flex items-center justify-center">
            <div className="w-3.5 h-3.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
          </div>
        </div>

        <h1 className="text-[26px] font-bold mb-1.5 tracking-tight">GoCash Tracker</h1>
        <p className="text-sm text-muted-foreground text-center max-w-[220px] leading-relaxed">
          Manage your GCash and MariBank transactions
        </p>
      </div>

      <div className="relative z-10 pb-16">
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-3xl p-5">
          {sent ? (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div className="flex flex-col items-center gap-3 pb-2">
                <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <KeyRound className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="font-semibold mb-1">Enter your code</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    We emailed a code to{" "}
                    <span className="text-foreground font-medium">{email}</span>.
                    Enter it below to sign in.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Sign-in code
                </Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  required
                  autoFocus
                  className="bg-white/[0.06] border-white/[0.1] h-12 rounded-xl text-center text-xl tracking-[0.5em] font-mono focus:border-emerald-500/50 focus:bg-white/[0.08] transition-colors"
                />
              </div>

              {error && (
                <p className="text-xs text-red-400 px-1">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || code.length < 6}
                className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-2xl text-[15px] transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify code"
                )}
              </button>

              <button
                type="button"
                onClick={() => { setSent(false); setCode(""); setError(null); }}
                className="w-full text-sm text-muted-foreground text-center py-1"
              >
                Use a different email
              </button>
            </form>
          ) : (
            <form onSubmit={handleSendLink} className="space-y-4">
              <button
                type="button"
                onClick={async () => {
                  setError(null);
                  setGoogleLoading(true);

                  try {
                    await startGoogleSignIn();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not start Google sign-in.");
                    setGoogleLoading(false);
                  }
                }}
                disabled={loading || googleLoading}
                className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-white/[0.1] bg-white/[0.06] text-sm font-semibold text-white transition-colors hover:bg-white/[0.08] disabled:opacity-50"
              >
                {googleLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                    <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3 .8 3.7 1.5l2.5-2.4C16.6 3.5 14.5 2.6 12 2.6 6.9 2.6 2.8 6.8 2.8 12s4.1 9.4 9.2 9.4c5.3 0 8.8-3.7 8.8-9 0-.6-.1-1.1-.2-1.5H12Z" />
                    <path fill="#34A853" d="M2.8 12c0 5.2 4.1 9.4 9.2 9.4 5.3 0 8.8-3.7 8.8-9 0-.6-.1-1.1-.2-1.5H12v3.9h5.4c-.2 1.3-1.6 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6Z" />
                    <path fill="#FBBC05" d="M4.9 7.4 8.1 9.8C9 7.6 10.4 6 12 6c1.8 0 3 .8 3.7 1.5l2.5-2.4C16.6 3.5 14.5 2.6 12 2.6 8.1 2.6 4.7 4.8 3.1 8.1l1.8-.7Z" />
                    <path fill="#4285F4" d="M3.1 8.1A9.5 9.5 0 0 0 2.8 12c0 1.5.4 2.9 1 4.2l3.2-2.5A5.9 5.9 0 0 1 6.1 12c0-.8.2-1.5.5-2.2L3.1 8.1Z" />
                  </svg>
                )}
                Continue with Google
              </button>

              <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted-foreground/50">
                <span className="h-px flex-1 bg-white/[0.08]" />
                Or
                <span className="h-px flex-1 bg-white/[0.08]" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Email address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70 pointer-events-none" />
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                    className="bg-white/[0.06] border-white/[0.1] h-12 rounded-xl pl-10 text-sm focus:border-emerald-500/50 focus:bg-white/[0.08] transition-colors"
                  />
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-400 px-1">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-2xl text-[15px] transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send sign-in link"
                )}
              </button>

              <p className="text-[11px] text-muted-foreground/60 text-center leading-relaxed">
                No password needed. New operators finish setup in onboarding after the magic link.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
