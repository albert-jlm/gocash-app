import { cn } from "@/lib/utils";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded-lg", className)} />;
}

function SkeletonTransaction() {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Skeleton className="w-9 h-9 rounded-xl flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-3 w-10" />
      </div>
    </div>
  );
}

function SkeletonWalletCard() {
  return (
    <div className="w-[min(84vw,20rem)] flex-shrink-0 sm:w-[20rem]">
      <div className="skeleton-shimmer h-[160px] rounded-3xl" />
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col bg-background text-foreground">
      {/* Header */}
      <div className="px-4 pb-5 pt-safe sm:px-6">
        <Skeleton className="h-3 w-24 mb-2" />
        <Skeleton className="h-6 w-36" />
      </div>

      {/* Wallet cards */}
      <div className="mb-4">
        <div className="flex gap-4 px-4 pb-2 sm:px-6">
          <SkeletonWalletCard />
          <SkeletonWalletCard />
        </div>
        <div className="flex justify-center gap-1.5 mt-3">
          <Skeleton className="w-4 h-1.5 rounded-full" />
          <Skeleton className="w-1.5 h-1.5 rounded-full" />
          <Skeleton className="w-1.5 h-1.5 rounded-full" />
        </div>
      </div>

      {/* Stats */}
      <div className="mb-5 px-4 sm:px-6">
        <Skeleton className="h-3 w-12 mb-3" />
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white/[0.05] rounded-xl p-3 flex flex-col items-center min-h-[72px] justify-center gap-2">
              <Skeleton className="h-5 w-10" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Recent transactions */}
      <div className="mb-24 px-4 sm:px-6">
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-10" />
        </div>
        <div className="bg-white/[0.04] rounded-2xl overflow-hidden divide-y divide-white/[0.05] border border-white/[0.05]">
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonTransaction key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SkeletonTransactionList() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col bg-background text-foreground">
      {/* Header */}
      <div className="px-4 pb-3 pt-safe sm:px-6">
        <Skeleton className="h-6 w-40 mb-1.5" />
        <Skeleton className="h-3 w-20" />
      </div>

      {/* Search + date */}
      <div className="mb-4 space-y-3 px-4 sm:px-6">
        <Skeleton className="w-full h-11 rounded-xl" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-11 rounded-xl" />
          <Skeleton className="h-11 rounded-xl" />
        </div>
      </div>

      {/* Filter pills */}
      <div className="mb-4 flex gap-2 px-4 sm:px-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full flex-shrink-0" />
        ))}
      </div>

      {/* Transaction groups */}
      <div className="flex-1 space-y-5 px-4 pb-32 sm:px-6">
        {[0, 1].map((g) => (
          <div key={g}>
            <Skeleton className="h-3 w-16 mb-2.5" />
            <div className="bg-white/[0.04] rounded-2xl overflow-hidden divide-y divide-white/[0.05] border border-white/[0.05]">
              {[0, 1, 2].map((i) => (
                <SkeletonTransaction key={i} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonTransactionDetail() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pb-4 pt-safe sm:px-6">
        <Skeleton className="w-9 h-9 rounded-full flex-shrink-0" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>

      {/* Hero card */}
      <div className="mb-5 px-4 sm:px-6">
        <div className="bg-white/[0.05] rounded-2xl p-5 flex items-center gap-4">
          <Skeleton className="w-12 h-12 rounded-2xl flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="flex flex-col items-end gap-2">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      </div>

      {/* Detail fields */}
      <div className="flex-1 px-4 sm:px-6">
        <div className="bg-white/[0.05] rounded-2xl p-4 space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      </div>

      {/* Buttons */}
      <div className="space-y-3 px-4 py-8 sm:px-6">
        <Skeleton className="h-12 w-full rounded-2xl" />
        <Skeleton className="h-12 w-full rounded-2xl" />
        <Skeleton className="h-12 w-full rounded-2xl" />
      </div>
    </div>
  );
}

function SkeletonConfirmForm() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pb-4 pt-safe sm:px-6">
        <Skeleton className="w-9 h-9 rounded-full flex-shrink-0" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>

      {/* AI banner */}
      <div className="mb-4 px-4 sm:px-6">
        <Skeleton className="h-14 w-full rounded-2xl" />
      </div>

      {/* Form fields */}
      <div className="flex-1 px-4 sm:px-6">
        <div className="rounded-2xl p-4 space-y-4 mb-4 bg-white/[0.06] border border-white/[0.08]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>

      {/* Save button */}
      <div className="px-5 pb-10 pt-4">
        <Skeleton className="h-14 w-full rounded-2xl" />
      </div>
    </div>
  );
}

export {
  Skeleton,
  SkeletonTransaction,
  SkeletonWalletCard,
  SkeletonDashboard,
  SkeletonTransactionList,
  SkeletonTransactionDetail,
  SkeletonConfirmForm,
};
