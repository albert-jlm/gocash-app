"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import {
  BadgePercent, Bell, ChevronRight, CircleHelp, Contact, LayoutGrid, LogOut, Moon, Share, Smartphone, Sun, Users, Wallet,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { readTheme, saveTheme, subscribeTheme, type ThemeChoice } from "@/lib/theme";

export default function SettingsPage() {
  const { session, role, loading } = useAuthGuard();
  const [signingOut, setSigningOut] = useState(false);
  const theme = useSyncExternalStore<ThemeChoice>(subscribeTheme, readTheme, () => "system");

  async function handleSignOut() {
    setSigningOut(true);
    // useAuthGuard listens for SIGNED_OUT and sends the app to /login.
    // `local` signs out this device only, and works without a connection.
    await supabase.auth.signOut({ scope: "local" });
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <AppShell active="settings" tabBar>
      <PageHeader title="Settings" />

      <section className="px-5 flex-1">
        <div className="mb-4">
          <p className="label">Appearance</p>
          <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1">
            {([["system", "Phone", Smartphone], ["light", "Light", Sun], ["dark", "Dark", Moon]] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                aria-label={value === "system" ? "Match the phone" : label}
                onClick={() => saveTheme(value)}
                className={`h-11 rounded-full text-[15px] font-medium flex items-center justify-center gap-2 transition-colors ${
                  theme === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                <Icon className="w-[18px] h-[18px]" strokeWidth={1.9} />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="card overflow-hidden divide-y divide-border">
          {[
            { label: "Wallets",               href: "/settings/wallets",       desc: "Balances and low-balance alerts", ownerOnly: true,  Icon: Wallet },
            { label: "Profit settings",       href: "/settings/rules",         desc: "Your fee on each type",           ownerOnly: true,  Icon: BadgePercent },
            { label: "Platforms",             href: "/settings/platforms",     desc: "Add or archive wallets",          ownerOnly: true,  Icon: LayoutGrid },
            { label: "My numbers & accounts", href: "/settings/my-accounts",   desc: "Your own numbers",                ownerOnly: true,  Icon: Contact },
            { label: "Staff",                 href: "/settings/staff",         desc: "Who else can record",             ownerOnly: true,  Icon: Users },
            { label: "Share from phone",      href: "/settings/share",         desc: "Send screenshots in",             ownerOnly: false, Icon: Share },
            { label: "Notifications",         href: "/settings/notifications", desc: "Telegram, coming soon",           ownerOnly: true,  Icon: Bell },
            { label: "Help",                  href: "/help",                   desc: "How-tos and questions",           ownerOnly: false, Icon: CircleHelp },
          ].filter((item) => role === "owner" || !item.ownerOnly)
           .map(({ label, href, desc, Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-3.5 px-4 py-3.5">
              <span className="w-10 h-10 rounded-full bg-background grid place-items-center flex-shrink-0">
                <Icon className="w-5 h-5" strokeWidth={1.9} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-medium">{label}</span>
                <span className="block text-[13px] text-muted-foreground">{desc}</span>
              </span>
              <ChevronRight className="w-[18px] h-[18px] text-muted-foreground flex-shrink-0" />
            </Link>
          ))}
        </div>

        <div className="mt-4 card px-4 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-muted-foreground">
              Signed in as {role === "staff" ? "staff" : "owner"}
            </p>
            <p className="text-[15px] font-medium truncate">{session?.user.email ?? "—"}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="btn btn-secondary btn-sm flex-shrink-0"
          >
            {signingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            Sign out
          </button>
        </div>

        <p className="text-[13px] text-muted-foreground/50 text-center mt-6">
          GoCash · v0.1
        </p>
      </section>
    </AppShell>
  );
}
