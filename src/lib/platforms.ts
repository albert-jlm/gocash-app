export const BUILTIN_PLATFORM_NAMES = ["GCash", "MariBank", "Maya"] as const;

export const TRANSACTION_TYPES = [
  "Cash In",
  "Cash Out",
  "Telco Load",
  "Bills Payment",
  "Bank Transfer",
  "Profit Remittance",
] as const;

export const COLOR_PALETTE = [
  {
    id: "blue",
    label: "Blue",
    gradient: "from-blue-500 via-blue-600 to-blue-700",
    swatch: "bg-blue-500",
    accent: "text-blue-400",
    glow: "rgba(59,130,246,0.30)",
  },
  {
    id: "purple",
    label: "Purple",
    gradient: "from-purple-500 via-purple-600 to-purple-700",
    swatch: "bg-purple-500",
    accent: "text-purple-400",
    glow: "rgba(139,92,246,0.30)",
  },
  {
    id: "emerald",
    label: "Green",
    gradient: "from-emerald-500 via-emerald-600 to-emerald-700",
    swatch: "bg-emerald-500",
    accent: "text-emerald-400",
    glow: "rgba(16,185,129,0.30)",
  },
  {
    id: "rose",
    label: "Red",
    gradient: "from-rose-500 via-rose-600 to-rose-700",
    swatch: "bg-rose-500",
    accent: "text-rose-400",
    glow: "rgba(244,63,94,0.30)",
  },
  {
    id: "orange",
    label: "Orange",
    gradient: "from-orange-500 via-orange-600 to-orange-700",
    swatch: "bg-orange-500",
    accent: "text-orange-400",
    glow: "rgba(249,115,22,0.30)",
  },
  {
    id: "amber",
    label: "Amber",
    gradient: "from-amber-500 via-amber-600 to-amber-700",
    swatch: "bg-amber-500",
    accent: "text-amber-400",
    glow: "rgba(245,158,11,0.30)",
  },
  {
    id: "cyan",
    label: "Cyan",
    gradient: "from-cyan-500 via-cyan-600 to-cyan-700",
    swatch: "bg-cyan-500",
    accent: "text-cyan-400",
    glow: "rgba(6,182,212,0.30)",
  },
  {
    id: "zinc",
    label: "Gray",
    gradient: "from-zinc-600 via-zinc-700 to-zinc-800",
    swatch: "bg-zinc-500",
    accent: "text-zinc-400",
    glow: "transparent",
  },
] as const;

export type WalletColorId = (typeof COLOR_PALETTE)[number]["id"];

const DEFAULT_WALLET_COLORS: Record<string, WalletColorId> = {
  GCash: "blue",
  MariBank: "purple",
  Maya: "cyan",
  Cash: "emerald",
};

const BUILTIN_PLATFORM_ORDER = new Map(
  BUILTIN_PLATFORM_NAMES.map((name, index) => [name, index])
);

export function isBuiltInPlatform(name: string): boolean {
  return BUILTIN_PLATFORM_ORDER.has(name as (typeof BUILTIN_PLATFORM_NAMES)[number]);
}

export function getDefaultWalletColor(walletName: string): WalletColorId {
  return DEFAULT_WALLET_COLORS[walletName] ?? "zinc";
}

export function getWalletColor(colorId?: string | null) {
  return COLOR_PALETTE.find((color) => color.id === colorId) ?? COLOR_PALETTE[COLOR_PALETTE.length - 1];
}

export function sortPlatformNames(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const orderA = BUILTIN_PLATFORM_ORDER.get(a as (typeof BUILTIN_PLATFORM_NAMES)[number]);
    const orderB = BUILTIN_PLATFORM_ORDER.get(b as (typeof BUILTIN_PLATFORM_NAMES)[number]);

    if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
    if (orderA !== undefined) return -1;
    if (orderB !== undefined) return 1;

    return a.localeCompare(b, "en", { sensitivity: "base" });
  });
}

/**
 * Returns true when a Supabase query error indicates the `operator_platforms`
 * table does not exist (e.g. migration not yet applied). Used by confirm-form,
 * platform settings, and the confirm Edge Function to fall back to the
 * `wallets` table for platform discovery.
 */
export function isMissingOperatorPlatformsError(message?: string | null): boolean {
  return Boolean(
    message && (
      message.includes("operator_platforms")
      || message.includes("schema cache")
      || message.includes("Could not find the table")
    )
  );
}

export function comparePlatformNames(a: string, b: string): number {
  return sortPlatformNames([a, b])[0] === a ? (a === b ? 0 : -1) : 1;
}

export function sortWallets<
  T extends { wallet_name: string; wallet_type: string }
>(wallets: T[]): T[] {
  return [...wallets].sort((a, b) => {
    if (a.wallet_type === b.wallet_type) {
      if (a.wallet_type === "platform") {
        return comparePlatformNames(a.wallet_name, b.wallet_name);
      }

      return a.wallet_name.localeCompare(b.wallet_name, "en", {
        sensitivity: "base",
      });
    }

    if (a.wallet_type === "platform") return -1;
    if (b.wallet_type === "platform") return 1;

    return a.wallet_type.localeCompare(b.wallet_type, "en", {
      sensitivity: "base",
    });
  });
}
