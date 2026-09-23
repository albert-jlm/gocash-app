/**
 * Client-side ledger helpers.
 *
 * Balances are derived: they are the sum of `gocash.postings`, read through the
 * `gocash.account_balances` view. Nothing here writes a balance, because a
 * derived balance cannot be written — the only way to change one is to post an
 * entry, and the ledger's RLS grants the browser SELECT and nothing else. Every
 * write below therefore belongs to an Edge Function that does not exist yet.
 *
 * The posting arithmetic itself is NOT reimplemented here. It lives in
 * `@core/postings.ts`, which is the single source of truth shared with the
 * Edge Functions — the same module the deleted `src/lib/transaction-processing.ts`
 * used to shadow (Audit #5 finding 4).
 */

import { toMinor, toPesos, type Minor } from "@core/money.ts";
import { reconcile } from "@core/postings.ts";
import type { AccountRef, Posting } from "@core/types.ts";

/**
 * Thrown by any call whose server endpoint has not been built yet.
 *
 * Deliberately loud. The alternative — a client that quietly writes a balance
 * somewhere — is the thing this rebuild exists to remove.
 */
export class NotImplementedError extends Error {
  readonly code = "NOT_IMPLEMENTED";
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

/** An account as the reconciliation screen knows it. */
export interface LedgerAccount {
  account_id: string;
  name: string;
  kind: AccountRef["kind"];
  /** Signed centavos, straight from `account_balances.balance_minor`. */
  balance_minor: Minor;
}

/** The `AccountRef` shape `@core/postings.ts` builds postings against. */
export function accountRef(account: Pick<LedgerAccount, "kind" | "name">): AccountRef {
  return account.kind === "platform"
    ? { kind: "platform", platform: account.name }
    : { kind: account.kind };
}

export interface ReconciliationInput {
  operatorId: string;
  account: LedgerAccount;
  /** What the operator actually counted, in pesos, as typed. */
  countedPesos: number;
  memo?: string;
}

/**
 * The difference a reconciliation would book, in centavos.
 *
 * Positive means the count came out ABOVE the books (the ledger was short);
 * negative means below. Zero means there is nothing to post.
 */
export function reconciliationDifferenceMinor(input: ReconciliationInput): Minor {
  return toMinor(input.countedPesos) - input.account.balance_minor;
}

/**
 * Preview the entry a reconciliation would write, so the screen can show the
 * operator the postings before anything is sent.
 *
 * Throws (via `balanced()`) when the difference is zero — an entry with nothing
 * to say is not a valid entry. Callers should not offer to submit in that case.
 */
export function previewReconciliation(input: ReconciliationInput): Posting[] {
  return reconcile({
    account: accountRef(input.account),
    bookBalanceMinor: input.account.balance_minor,
    countedBalanceMinor: toMinor(input.countedPesos),
  });
}

/**
 * Post a drawer-count correction.
 *
 * Replaces the old `UPDATE gocash.wallets SET balance = ...` that Settings →
 * Wallets used to issue directly from the browser (Audit #5 finding 14: an
 * untraceable balance overwrite in a money-handling app). The posting shape
 * already exists server-side as `reconcile()` in
 * `supabase/functions/_core/postings.ts`.
 *
 * MISSING ENDPOINT: there is no route that calls it yet. It needs a
 * `reconcile-account` handler — `supabase/functions/main/_reconcile_account.ts`,
 * registered in the `routes` map in `supabase/functions/main/index.ts` — which
 * writes a `kind = 'reconciliation'` row to `gocash.ledger_entries` plus the two
 * postings, using the service-role key. Until that exists this throws rather
 * than pretending, and no endpoint is invented here to paper over it.
 */
export async function postReconciliation(input: ReconciliationInput): Promise<never> {
  // Validate locally first, so a bad form never reaches the (future) endpoint
  // and so the thrown error is about the real problem when there is one.
  previewReconciliation(input);

  throw new NotImplementedError(
    "NOT_IMPLEMENTED: posting a reconciliation entry requires the " +
      "`reconcile-account` Edge Function route, which has not been built yet."
  );
}

export interface ProvisionOperatorInput {
  userId: string;
  name: string;
  email: string;
  /**
   * Optional. NOTE: `gocash.provision_operator` has no `p_phone` argument yet,
   * so the endpoint that calls it has to write `operators.phone` itself (or the
   * function needs the argument adding). Collected here so the signup form does
   * not quietly drop what the operator typed.
   */
  phone?: string | null;
  /** Platform accounts to create, e.g. ["GCash", "MariBank", "Maya"]. */
  platforms: readonly string[];
  /**
   * Account name -> opening balance in CENTAVOS, matching the RPC's own unit.
   * A fractional value is rejected server-side rather than rounded, because a
   * caller sending pesos is a 100x error.
   */
  openingMinor: Record<string, Minor>;
}

/**
 * Sign a new operator up: the operator row, the chart of accounts, their
 * platform accounts, default fee rules and the opening entry — one transaction.
 *
 * Replaces the sequence onboarding used to run from the browser (insert an
 * operator, upsert three `wallets` rows with their balances, seed
 * `transaction_rules`). None of that is possible now and none of it should be:
 * `wallets` and `transaction_rules` are being dropped, an opening balance is a
 * posted entry rather than a column, and the ledger grants the browser SELECT
 * only.
 *
 * MISSING ENDPOINT: the database side already exists —
 * `gocash.provision_operator(p_user_id, p_name, p_email, p_platforms, p_opening)`
 * in `supabase/migrations/20260924000005_provision_operator.sql`. It is granted
 * to `service_role` ONLY, deliberately: `p_user_id` is caller-supplied, so a
 * grant to `authenticated` would let any signed-in user attach an operator to
 * any auth user. It therefore needs a `provision-operator` handler
 * (`supabase/functions/main/_provision_operator.ts`, registered in the `routes`
 * map in `supabase/functions/main/index.ts`) that takes the user id from the
 * VERIFIED JWT rather than the request body, and calls the RPC with the
 * service-role key. Until that exists this throws.
 */
export async function provisionOperator(input: ProvisionOperatorInput): Promise<never> {
  void input;
  throw new NotImplementedError(
    "NOT_IMPLEMENTED: signing up requires the `provision-operator` Edge Function " +
      "route, which has not been built yet. The database function it needs to call " +
      "(gocash.provision_operator) is service-role only and cannot be called from here."
  );
}

/** Pesos as typed into a form, to the exact centavo integer the ledger uses. */
export { toMinor as pesosToMinor };

/** "₱1,234.50" — the format every screen already uses. */
export function formatPesos(pesos: number): string {
  return (
    "₱" +
    pesos.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** Same, from centavos. */
export function formatMinorPesos(minor: Minor): string {
  return formatPesos(toPesos(minor));
}
