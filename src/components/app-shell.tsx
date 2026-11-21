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
import { Camera, History, Home, Keyboard, ScanLine, Settings } from "lucide-react";

export type NavKey = "home" | "new" | "history" | "settings";

const TABS: { key: NavKey | "screenshot"; href: string; label: string; Icon: React.ElementType }[] = [
  { key: "home",       href: "/",             label: "Home",     Icon: Home },
  { key: "history",    href: "/transactions", label: "History",  Icon: History },
  { key: "screenshot", href: "/capture",      label: "Scan",     Icon: ScanLine },
  { key: "settings", href: "/settings",     label: "Settings", Icon: Settings },
];

const SIDEBAR: { key: NavKey | "screenshot"; href: string; label: string; Icon: React.ElementType }[] = [
  { key: "home",       href: "/",             label: "Home",              Icon: Home },
  { key: "new",        href: "/new",          label: "New transaction",   Icon: Keyboard },
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
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-border bg-muted/60 px-4 py-6">
        <Link href="/" className="px-2 mb-8 block">
          <p className="font-heading text-[19px] font-bold tracking-tight">GoCash</p>
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
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="app-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain lg:pl-60">
        <div
          className={[
            "app-enter relative flex flex-col min-h-full w-full mx-auto",
            "max-w-[480px] sm:max-w-2xl",
            wide ? "lg:max-w-5xl" : "lg:max-w-2xl",
            className,
          ].join(" ")}
        >
          {children}
        </div>
      </main>

      {tabBar && (
        <div className="lg:hidden flex-shrink-0 bg-background border-t border-border pb-[env(safe-area-inset-bottom)]">
          <nav className="mx-auto w-full max-w-[480px] sm:max-w-2xl grid grid-cols-4 h-16">
            {TABS.map(({ key, href, label, Icon }) => {
              const on = key === active;
              return (
                <Link
                  key={key}
                  href={href}
                  aria-current={on ? "page" : undefined}
                  className="flex flex-col items-center justify-center gap-0.5"
                >
                  <Icon className={`w-5 h-5 ${on ? "text-foreground" : "text-muted-foreground"}`} />
                  <span className={`text-xs ${on ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
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
