"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace("/");
      } else {
        setCheckingSession(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        router.replace("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin + "/",
      },
    });

    setLoading(false);

    if (otpError) {
      // Signups are closed: only emails the owner has added can sign in. The
      // service's own wording for that is "Signups not allowed for otp".
      setError(
        /signups? not allowed/i.test(otpError.message)
          ? "This email doesn't have access yet. Ask the shop owner to add it under Settings → Staff."
          : otpError.message
      );
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
    // onAuthStateChange handles redirect on success
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  const field =
    "w-full h-[54px] rounded-2xl bg-muted px-4 text-base outline-none border border-transparent focus:border-primary";
  const primary =
    "font-heading w-full h-[54px] rounded-full bg-primary text-primary-foreground font-semibold text-[17px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-col min-h-dvh bg-background text-foreground w-full max-w-[400px] mx-auto px-6 sm:justify-center">
      <div className="flex-1 sm:flex-none flex flex-col items-center justify-center pt-[calc(env(safe-area-inset-top)+2rem)] pb-8 sm:pb-10">
        <img src="/logo.svg" alt="" width={76} height={76} className="rounded-[20px] mb-5 dark:ring-1 dark:ring-input" />
        <h1 className="text-[30px] font-bold tracking-tight leading-none">gocash</h1>
        <p className="text-sm text-muted-foreground mt-2">Your shop&apos;s books</p>
      </div>

      <div className="pb-[max(2rem,env(safe-area-inset-bottom))] sm:pb-0">
        {sent ? (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              We emailed a code to <span className="text-foreground font-medium">{email}</span>.
            </p>
            <label htmlFor="code" className="sr-only">Sign-in code</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              required
              autoFocus
              autoComplete="one-time-code"
              className={`${field} amount text-center text-2xl font-semibold tracking-[0.4em]`}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button type="submit" disabled={loading || code.length < 6} className={primary}>
              {loading ? (<><Loader2 className="w-4 h-4 animate-spin" />Checking…</>) : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => { setSent(false); setCode(""); setError(null); }}
              className="w-full h-11 text-sm text-muted-foreground underline underline-offset-4"
            >
              Use a different email
            </button>
          </form>
        ) : (
          <form onSubmit={handleSendLink} className="space-y-3">
            <label htmlFor="email" className="text-[13px] text-muted-foreground">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              className={field}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button type="submit" disabled={loading || !email} className={primary}>
              {loading ? (<><Loader2 className="w-4 h-4 animate-spin" />Sending…</>) : "Email me a sign-in code"}
            </button>
            <p className="text-[13px] text-muted-foreground text-center">No password needed.</p>
          </form>
        )}
      </div>
    </div>
  );
}
