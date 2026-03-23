"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  Loader2,
  LogOut,
  Mail,
  ShieldCheck,
  Smartphone,
  UserRound,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { signOutCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

interface OperatorProfile {
  name: string;
  email: string;
  phone: string | null;
  subscription_tier: string | null;
}

function formatProvider(provider: string | undefined): string {
  if (!provider) return "Email";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export default function ProfilePage() {
  const router = useRouter();
  const { session, operatorId, loading: authLoading } = useAuthGuard();
  const [profile, setProfile] = useState<OperatorProfile | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId;

    let cancelled = false;

    async function loadProfile() {
      const { data, error: fetchError } = await supabase
        .from("operators")
        .select("name, email, phone, subscription_tier")
        .eq("id", opId)
        .single();

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        setDataLoading(false);
        return;
      }

      setProfile(data);
      setDataLoading(false);
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [operatorId]);

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);

    try {
      await signOutCurrentUser();
      router.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log out.");
      setSigningOut(false);
    }
  }

  if (authLoading || dataLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 px-4 pb-4 pt-12 sm:px-6 sm:pt-14 lg:px-8">
        <Link
          href="/settings"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.07]"
        >
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-base font-semibold">Profile</h1>
          <p className="text-xs text-muted-foreground">Your account, sign-in method, and logout.</p>
        </div>
      </header>

      <section className="flex-1 space-y-4 px-4 pb-10 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.04]">
          <div className="relative border-b border-white/[0.05] px-5 py-6">
            <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.18),transparent_72%)]" />
            <div className="relative flex items-start gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15">
                <UserRound className="h-7 w-7 text-emerald-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold">{profile?.name || "GoCash Operator"}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {profile?.email || session?.user.email || "No email available"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {formatProvider(session?.user.app_metadata.provider)}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/15 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-wider text-emerald-300">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    {profile?.subscription_tier || "free"} plan
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="divide-y divide-white/[0.05]">
            <div className="flex items-center gap-3 px-5 py-4">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Email</p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email || session?.user.email || "Not set"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-5 py-4">
              <Smartphone className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Phone</p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.phone || "No phone number saved"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3.5">
          <p className="text-sm font-semibold">Security</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            You can sign in with Google or email magic link. Logging out clears the local session on this device.
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        <button
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-red-500 text-sm font-semibold text-white transition-colors hover:bg-red-400 active:bg-red-600 disabled:opacity-50"
        >
          {signingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          Log out
        </button>
      </section>
    </div>
  );
}
