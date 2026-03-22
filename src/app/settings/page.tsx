"use client";

import Link from "next/link";
import { ArrowLeft, Home, Plus, History, Settings } from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { Loader2 } from "lucide-react";

export default function SettingsPage() {
  const { loading } = useAuthGuard();

  if (loading) {
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
            { label: "Wallets",          href: "/settings/wallets",       desc: "View and adjust balances" },
            { label: "Profit Settings",  href: "/settings/rules",         desc: "Edit how earnings are calculated" },
            { label: "Platforms",        href: "/settings/platforms",     desc: "Manage GCash, MariBank, and more" },
            { label: "Notifications",    href: "/settings/notifications", desc: "Save Telegram alert preferences" },
          ].map(({ label, href, desc }) => (
            <Link key={href} href={href} className="flex items-center justify-between px-4 py-4">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
              <span className="text-muted-foreground/40 text-lg">›</span>
            </Link>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground/50 text-center mt-6">
          GoCash Tracker · v0.1
        </p>
      </section>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] px-5 pb-8 pt-4 bg-gradient-to-t from-background via-background/95 to-transparent">
        <nav className="flex items-center justify-around">
          <Link href="/" className="flex flex-col items-center gap-1 min-w-[48px]">
            <Home className="w-5 h-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Home</span>
          </Link>
          <Link href="/capture" className="flex flex-col items-center gap-1 min-w-[48px]">
            <Plus className="w-5 h-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">New</span>
          </Link>
          <Link href="/transactions" className="flex flex-col items-center gap-1 min-w-[48px]">
            <History className="w-5 h-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">History</span>
          </Link>
          <Link href="/settings" className="flex flex-col items-center gap-1 min-w-[48px]">
            <Settings className="w-5 h-5 text-foreground" />
            <span className="text-[10px] text-foreground font-medium">Settings</span>
          </Link>
        </nav>
      </div>
    </div>
  );
}
