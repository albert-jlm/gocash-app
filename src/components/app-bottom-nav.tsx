"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, Home, Plus, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Home",
    Icon: Home,
    forceReload: false,
    isActive: (pathname: string) => pathname === "/",
  },
  {
    href: "/capture",
    label: "New",
    Icon: Plus,
    forceReload: false,
    isActive: (pathname: string) => pathname.startsWith("/capture"),
  },
  {
    href: "/transactions/",
    label: "History",
    Icon: History,
    forceReload: true,
    isActive: (pathname: string) => pathname.startsWith("/transactions") || pathname.startsWith("/confirm"),
  },
  {
    href: "/settings",
    label: "Settings",
    Icon: Settings,
    forceReload: false,
    isActive: (pathname: string) => pathname.startsWith("/settings"),
  },
] as const;

export function AppBottomNav() {
  const pathname = usePathname();

  return (
    <div className="pointer-events-none fixed bottom-0 left-1/2 z-40 w-full max-w-5xl -translate-x-1/2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:px-8">
      <nav className="pointer-events-auto mx-auto flex w-full max-w-md items-center gap-1 rounded-[28px] border border-white/[0.08] bg-black/55 p-2 shadow-[0_-18px_45px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        {NAV_ITEMS.map(({ href, label, Icon, isActive, forceReload }) => {
          const active = isActive(pathname);

          const className = cn(
            "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 text-[10px] font-medium transition-all duration-200 tap-scale",
            active
              ? "bg-emerald-500 text-white shadow-[0_10px_25px_rgba(16,185,129,0.28)]"
              : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
          );

          if (forceReload) {
            return (
              <a key={href} href={href} className={className}>
                <Icon className={cn("h-5 w-5", active ? "scale-105" : "")} />
                <span>{label}</span>
              </a>
            );
          }

          return (
            <Link key={href} href={href} className={className}>
              <Icon className={cn("h-5 w-5", active ? "scale-105" : "")} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
