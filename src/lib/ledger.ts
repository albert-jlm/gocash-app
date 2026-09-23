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
import { supabase } from "@/lib/supabase/client";

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
  /**
   * Guards the race between two taps that both read the same book balance.
   *
   * The endpoint derives a fallback key from the state transition if this is
   * absent, but a client-supplied one is stronger: it is stable across a retry
   * of the SAME submission, where a derived key would change if the book
   * balance moved in between.
   */
  idempotencyKey?: string;
}

export interface ReconciliationResult {
  /** False when the count matched the ledger and there was nothing to write. */
  posted: boolean;
  /** True when this exact correction had already been posted. */
  replayed: boolean;
  entryId: string | null;
  differenceMinor: Minor;
  newBalanceMinor: Minor;
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
export async function postReconciliation(
  input: ReconciliationInput
): Promise<ReconciliationResult> {
  // Validate locally first, so a bad form never reaches the endpoint and the
  // thrown error is about the real problem when there is one.
  previewReconciliation(input);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/reconcile-account`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      // operator_id is deliberately NOT sent. The endpoint resolves it from the
      // verified JWT; a caller-supplied operator id is the shape that caused
      // Audit #5a. The book balance is not sent either — the server reads it,
      // so a stale page cannot decide how much to adjust by.
      body: JSON.stringify({
        account_id: input.account.account_id,
        counted_pesos: input.countedPesos,
        memo: input.memo,
        idempotency_key: input.idempotencyKey,
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Could not post the reconciliation");
  }

  return {
    posted: data.posted !== false,
    replayed: data.replayed === true,
    entryId: data.entry_id ?? null,
    differenceMinor: data.difference_minor ?? 0,
    newBalanceMinor: data.new_balance_minor ?? input.account.balance_minor,
  };
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
export interface ProvisionOperatorResult {
  operatorId: string;
  accounts: { id: string; kind: string; name: string }[];
  openingEntryId: string | null;
  /**
   * False when the phone number could not be saved.
   *
   * gocash.provision_operator has no p_phone argument, so the endpoint writes
   * it in a second statement OUTSIDE the provisioning transaction. That makes
   * it best-effort by construction: the operator, accounts and opening entry
   * are already committed, so failing the request would report a successful
   * signup as failed — and the retry would then hit the already-provisioned
   * 409. Surfaced rather than hidden so the UI can prompt for it later.
   */
  phoneSaved: boolean;
}

export async function provisionOperator(
  input: ProvisionOperatorInput
): Promise<ProvisionOperatorResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/provision-operator`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      // userId is sent but the endpoint uses the VERIFIED token id; it only
      // compares them and rejects a mismatch. gocash.provision_operator is
      // service-role only precisely because p_user_id is caller-supplied —
      // granting it to authenticated would be an account-takeover primitive.
      body: JSON.stringify({
        userId: input.userId,
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        platforms: input.platforms,
        openingMinor: input.openingMinor,
      }),
    }
  );

  const data = await response.json();

  if (response.status === 409 && data.operator_id) {
    // Already provisioned. A retry after a lost response lands here, and so
    // does a stale tab — the endpoint returns 409 rather than 200 because the
    // platforms and opening balances in THIS request were discarded, and a
    // success screen would be claiming an opening entry that was never written.
    // The id is returned either way, so the caller can route to the dashboard.
    const err = new Error("This account has already been set up") as Error & {
      code?: string; operatorId?: string;
    };
    err.code = "ALREADY_PROVISIONED";
    err.operatorId = data.operator_id;
    throw err;
  }

  if (!response.ok) {
    throw new Error(data.error ?? "Could not set up your account");
  }

  return {
    operatorId: data.operator_id,
    accounts: data.accounts ?? [],
    openingEntryId: data.opening_entry_id ?? null,
    phoneSaved: data.phone_saved !== false,
  };
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
