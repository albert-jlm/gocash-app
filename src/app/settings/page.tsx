"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import {
  buildFinancialSettingsHref,
  coerceFinancialSettingsTab,
  type FinancialSettingsTab,
} from "@/lib/platforms";
import { PlatformsPanel } from "./_components/platforms-panel";
import { ProfitSettingsPanel } from "./_components/profit-settings-panel";
import { WalletsPanel } from "./_components/wallets-panel";

const TAB_LABELS: Record<FinancialSettingsTab, { title: string; desc: string }> = {
  wallets: {
    title: "Wallets",
    desc: "Balances, colors, and your protected cash register",
  },
  platforms: {
    title: "Platforms",
    desc: "Add, restore, or safely delete transaction platforms",
  },
  profit: {
    title: "Profit Settings",
    desc: "Control how earnings are calculated per transaction type",
  },
};

function SettingsPageContent() {
  const { session, operatorId, loading } = useAuthGuard();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeTab = coerceFinancialSettingsTab(searchParams.get("tab"));
  const restorePlatformName = searchParams.get("restorePlatform");

  const title = TAB_LABELS[activeTab];
  const currentHref = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

  function setTab(tab: FinancialSettingsTab) {
    router.replace(buildFinancialSettingsHref(tab));
  }

  function clearRestorePlatform() {
    router.replace(buildFinancialSettingsHref("platforms"));
  }

  if (loading || !operatorId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[390px] flex-col bg-background text-foreground">
      <header className="px-5 pb-4 pt-14">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.07]"
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-base font-semibold">Financial Settings</h1>
            <p className="text-xs text-muted-foreground">{title.desc}</p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-1">
          <div className="grid grid-cols-3 gap-1">
            {(["wallets", "platforms", "profit"] as FinancialSettingsTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setTab(tab)}
                className={[
                  "rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  activeTab === tab
                    ? "bg-white text-zinc-900"
                    : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
                ].join(" ")}
              >
                {TAB_LABELS[tab].title}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="flex-1 px-5 pb-24">
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground">Telegram alert preferences stay separate.</p>
          </div>
          <Link
            href={`/settings/notifications?from=${encodeURIComponent(currentHref)}`}
            className="text-sm font-medium text-emerald-400"
          >
            Open →
          </Link>
        </div>

        {activeTab === "wallets" && <WalletsPanel operatorId={operatorId} />}
        {activeTab === "platforms" && (
          <PlatformsPanel
            operatorId={operatorId}
            userId={session?.user.id ?? null}
            restorePlatformName={restorePlatformName}
            onRestoreHandled={clearRestorePlatform}
          />
        )}
        {activeTab === "profit" && <ProfitSettingsPanel operatorId={operatorId} />}
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
        </div>
      }
    >
      <SettingsPageContent />
    </Suspense>
  );
}
