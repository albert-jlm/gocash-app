/**
 * The two accounts of a Wallet Transfer.
 *
 * A transfer names where the shop's money comes from and where it goes. Each
 * end is either the cash drawer ("Cash") or one of the operator's ACTIVE
 * wallets. Names are matched without regard to case and returned as stored,
 * because post_entry looks accounts up by their exact name.
 */

import { CASH_ACCOUNT_NAME } from "../../_core/types.ts";

export type TransferAccounts =
  | { ok: true; from: string; to: string }
  | { ok: false; error: string; code: string };

export const MAX_PLATFORM_FEE_PESOS = 10_000;

export async function resolveTransferAccounts(
  // deno-lint-ignore no-explicit-any
  admin: any,
  operatorId: string,
  from: string | null | undefined,
  to: string | null | undefined,
): Promise<TransferAccounts> {
  const fromName = (from ?? "").trim();
  const toName = (to ?? "").trim();

  if (!fromName || fromName === "Unknown") {
    return { ok: false, error: "Choose where the money came from", code: "transfer_from_required" };
  }
  if (!toName) {
    return { ok: false, error: "Choose where the money went", code: "transfer_to_required" };
  }

  const { data: wallets, error } = await admin
    .from("accounts").select("name")
    .eq("operator_id", operatorId).eq("kind", "platform").eq("is_active", true);
  if (error) {
    return { ok: false, error: "Could not load your wallets", code: "wallets_unavailable" };
  }

  const canonical = (name: string): string | null => {
    if (name.toLowerCase() === CASH_ACCOUNT_NAME.toLowerCase()) return CASH_ACCOUNT_NAME;
    const hit = (wallets ?? []).find((w: { name: string }) => w.name.toLowerCase() === name.toLowerCase());
    return hit ? hit.name : null;
  };

  const resolvedFrom = canonical(fromName);
  const resolvedTo = canonical(toName);
  if (!resolvedFrom) {
    return { ok: false, error: `You have no active wallet named "${fromName}"`, code: "unknown_platform" };
  }
  if (!resolvedTo) {
    return { ok: false, error: `You have no active wallet named "${toName}"`, code: "unknown_platform" };
  }
  if (resolvedFrom === resolvedTo) {
    return { ok: false, error: "The money has to move between two different places", code: "same_account" };
  }
  return { ok: true, from: resolvedFrom, to: resolvedTo };
}

/** A platform's charge for the move, in pesos. Null when it is not a usable figure. */
export function readPlatformFee(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_PLATFORM_FEE_PESOS) return null;
  return Math.round(value * 100) / 100;
}
