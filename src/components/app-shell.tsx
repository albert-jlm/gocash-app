"use client";

/**
 * The frame every signed-in screen sits in.
 *
 * ADAPTIVE, PHONE FIRST. The app was a fixed 390px column on every device, so
 * on a laptop it rendered as a phone-sized strip. The same screens now sit in:
 *
 *   phone    one full-width column, with the bottom tab bar on the main screens
 *   tablet   the same column, wider
 *   desktop  a sidebar for navigation and a content area beside it; the tab
 *            bar is gone because the sidebar does its job
 *
 * Screens choose how wide their content may grow on a desktop: `wide` for
 * dashboards and lists, the default for forms, which read badly when stretched.
 */

import Link from "next/link";
import { Camera, History, Home, Keyboard, Plus, Settings } from "lucide-react";

export type NavKey = "home" | "new" | "history" | "settings";

const TABS: { key: NavKey; href: string; label: string; Icon: React.ElementType }[] = [
  { key: "home",     href: "/",             label: "Home",     Icon: Home },
  { key: "new",      href: "/entry",        label: "New",      Icon: Plus },
  { key: "history",  href: "/transactions", label: "History",  Icon: History },
  { key: "settings", href: "/settings",     label: "Settings", Icon: Settings },
];

const SIDEBAR: { key: NavKey | "screenshot"; href: string; label: string; Icon: React.ElementType }[] = [
  { key: "home",       href: "/",             label: "Home",              Icon: Home },
  { key: "new",        href: "/entry",        label: "Type a transaction", Icon: Keyboard },
  { key: "screenshot", href: "/capture",      label: "Upload a screenshot", Icon: Camera },
  { key: "history",    href: "/transactions", label: "History",           Icon: History },
  { key: "settings",   href: "/settings",     label: "Settings",          Icon: Settings },
];

export function AppShell({
  active,
  tabBar = false,
  wide = false,
  className = "",
  children,
}: {
  /** Which destination to highlight. */
  active?: NavKey | "screenshot";
  /** Show the bottom tab bar on phones. Main screens only; the rest have a back arrow. */
  tabBar?: boolean;
  /** Let the content use the full desktop width. */
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-white/[0.06] bg-white/[0.02] px-4 py-6">
        <Link href="/" className="px-2 mb-8 block">
          <p className="text-[11px] font-medium tracking-widest uppercase text-muted-foreground">GoCash</p>
          <p className="text-lg font-semibold">Tracker</p>
        </Link>
        <nav className="flex flex-col gap-1">
          {SIDEBAR.map(({ key, href, label, Icon }) => {
            const on = key === active;
            return (
              <Link
                key={key}
                href={href}
                aria-current={on ? "page" : undefined}
                className={[
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                  on
                    ? "bg-white/[0.08] text-foreground font-medium"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <div className="lg:pl-60">
        <div
          className={[
            "relative flex flex-col min-h-screen w-full mx-auto",
            "max-w-[430px] sm:max-w-xl",
            wide ? "lg:max-w-5xl" : "lg:max-w-2xl",
            className,
          ].join(" ")}
        >
          {children}
        </div>
      </div>

      {/* Phone tab bar */}
      {tabBar && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 pointer-events-none bg-gradient-to-t from-background via-background/95 to-transparent">
          <nav className="pointer-events-auto mx-auto w-full max-w-[430px] sm:max-w-xl flex items-center justify-around px-5 pb-8 pt-4">
            {TABS.map(({ key, href, label, Icon }) => {
              const on = key === active;
              return (
                <Link
                  key={key}
                  href={href}
                  aria-current={on ? "page" : undefined}
                  className="flex flex-col items-center gap-1 min-w-[48px]"
                >
                  <Icon className={`w-5 h-5 ${on ? "text-foreground" : "text-muted-foreground"}`} />
                  <span className={`text-[10px] ${on ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                    {label}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}
