"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Home, Plus, History, Settings, LogOut } from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";

export default function SettingsPage() {
  const { session, role, loading } = useAuthGuard();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    // useAuthGuard listens for SIGNED_OUT and sends the app to /login.
    // `local` signs out this device only, and works without a connection.
    await supabase.auth.signOut({ scope: "local" });
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <AppShell active="settings" tabBar>
      <header className="px-5 pt-14 lg:pt-10 pb-4 flex items-center gap-3">
        <Link
          href="/"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <h1 className="text-base font-semibold">Settings</h1>
      </header>

      <section className="px-5 flex-1">
        <div className="bg-white/[0.05] rounded-2xl overflow-hidden divide-y divide-white/[0.06]">
          {[
            // Balances are derived from the ledger now, so this screen reconciles
            // against a count instead of letting one be typed over.
            { label: "Wallets",          href: "/settings/wallets",       desc: "Check balances against a count", ownerOnly: true },
            { label: "Profit Settings",  href: "/settings/rules",         desc: "Edit how earnings are calculated", ownerOnly: true },
            { label: "Platforms",        href: "/settings/platforms",     desc: "Add or remove wallets", ownerOnly: true },
            { label: "Staff",            href: "/settings/staff",         desc: "Who else can record transactions", ownerOnly: true },
            { label: "Share from phone", href: "/settings/share",         desc: "Send screenshots from the share sheet", ownerOnly: false },
            { label: "Notifications",    href: "/settings/notifications", desc: "Telegram alerts (coming soon)", ownerOnly: true },
          // Staff see only what they can use. The server refuses the rest
          // regardless of what is shown here.
          ].filter((item) => role === "owner" || !item.ownerOnly)
           .map(({ label, href, desc }) => (
            <Link key={href} href={href} className="flex items-center justify-between px-4 py-4">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
              <span className="text-muted-foreground/40 text-lg">›</span>
            </Link>
          ))}
        </div>

        <div className="mt-4 bg-white/[0.05] rounded-2xl px-4 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              Signed in as {role === "staff" ? "staff" : "owner"}
            </p>
            <p className="text-sm font-medium truncate">{session?.user.email ?? "—"}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-2 bg-white/[0.07] text-sm font-medium px-3.5 py-2.5 rounded-xl flex-shrink-0 disabled:opacity-50"
          >
            {signingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            Sign out
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground/50 text-center mt-6">
          GoCash Tracker · v0.1
        </p>
      </section>
    </AppShell>
  );
}
