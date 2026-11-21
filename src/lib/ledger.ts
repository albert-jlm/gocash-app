/**
 * Client-side ledger helpers.
 *
 * Balances are derived: they are the sum of `gocash.postings`, read through the
 * `gocash.account_balances` view. Nothing here writes a balance, because a
 * derived balance cannot be written — the only way to change one is to post an
 * entry, and the ledger's RLS grants the browser SELECT and nothing else. Every
 * write below therefore goes through an Edge Function holding the service-role
 * key: `create-transaction`, `confirm-transaction`, `reconcile-account`,
 * `provision-operator`.
 *
 * The posting arithmetic itself is NOT reimplemented here. It lives in
 * `@core/postings.ts`, which is the single source of truth shared with the
 * Edge Functions — the same module the deleted `src/lib/transaction-processing.ts`
 * used to shadow (Audit #5 finding 4). What this file computes is a PREVIEW:
 * the server reprices at the gate and the server wins. They agree because
 * they are the same function, not because the figures are kept in step.
 */

import { toMinor, toPesos, type Minor } from "@core/money.ts";
import { reconcile } from "@core/postings.ts";
import { quoteEntry, type EntryQuote } from "@core/entry.ts";
import type { AccountRef, FeeRule, Posting, TransactionType } from "@core/types.ts";
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
 * The endpoint is `supabase/functions/main/_reconcile_account.ts`, registered as
 * `reconcile-account`. It writes a `kind = 'reconciliation'` entry plus the two
 * postings with the service-role key, and it reads the book balance itself —
 * which is why this function does not send one.
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
    // `balance_minor`, not `new_balance_minor`. The endpoint has never returned
    // a field by the latter name, so this read was always undefined and fell
    // through to the PRE-count balance — the form reported a successful
    // reconciliation and then showed the figure that had just been corrected,
    // which looks exactly like the correction not having been applied.
    newBalanceMinor: typeof data.balance_minor === "number"
      ? data.balance_minor
      : input.account.balance_minor,
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

// ===========================================================================
// Manual entry
//
// Typing a transaction instead of photographing one. This is the primary path:
// no vision model, no upload, nothing to misread, and it works on a connection
// too weak to carry a 2 MB image. `process-transaction` stays as the
// screenshot convenience on top of it.
// ===========================================================================

export interface EntryContext {
  /** Platform names this operator actually holds an active account for. */
  platforms: string[];
  /** Fee rules currently in force, for the live preview. */
  rules: FeeRule[];
}

/**
 * Everything the entry form needs to price and validate without a round-trip.
 *
 * Both reads are RLS-scoped to the signed-in operator: `account_balances` is a
 * `security_invoker` view and `fee_rules` has a SELECT-only policy. Neither
 * takes an operator id from this code, so a tampered client sees its own rows
 * or none.
 */
export async function loadEntryContext(): Promise<EntryContext> {
  const [{ data: accounts, error: accountsError }, { data: rules, error: rulesError }] =
    await Promise.all([
      supabase
        .from("account_balances")
        .select("name, kind")
        .eq("kind", "platform")
        .order("name"),
      supabase
        .from("fee_rules")
        .select("transaction_type, platform, rate_bps, minimum_minor")
        .is("effective_to", null),
    ]);

  if (accountsError) throw new Error(accountsError.message);
  if (rulesError) throw new Error(rulesError.message);

  return {
    platforms: (accounts ?? []).map((a) => a.name as string),
    rules: (rules ?? []).map((r) => ({
      transaction_type: r.transaction_type as string,
      platform: r.platform as string,
      rate_bps: Number(r.rate_bps),
      minimum_minor: Number(r.minimum_minor),
      is_active: true,
    })),
  };
}

export interface EntryInput {
  transactionType: TransactionType;
  /** Empty for Profit Remittance, which touches no platform wallet. */
  platform: string;
  amountPesos: number;
  referenceNumber?: string | null;
  accountNumber?: string | null;
  transactionDate?: string | null;
  /** Cash Out only. Never inferred — the operator answers it. */
  amountIncludesFee?: boolean;
  /**
   * Wallet Transfer only. `platform` is where the money comes from and
   * `transferTo` where it goes; either may be "Cash". `platformFeePesos` is
   * what the platform charged for the move.
   */
  transferTo?: string | null;
  platformFeePesos?: number;
  /**
   * Stable across every retry of ONE Save tap. Hold it in a ref; generating it
   * inside the submit handler defeats the entire purpose, which is that a
   * double tap or a lost response cannot produce a second draft or a second
   * ledger entry.
   */
  idempotencyKey: string;
  memo?: string | null;
}

/**
 * Re-exported under the name the UI uses. Not restated: a second declaration of
 * the same four fields is a second thing to keep in step.
 */
export type EntryPreview = EntryQuote;

/**
 * What saving this form would do, computed locally so the figures update as the
 * operator types.
 *
 * A thin adapter over `quoteEntry` in `@core/entry.ts` — the same function
 * `create-transaction` and `confirm-transaction` run server-side. So the
 * preview is not an approximation of the posting, it IS the posting, and
 * `_core/__tests__/entry.test.ts` asserts that property directly instead of it
 * resting on two files being kept in step by hand.
 *
 * One case can still disagree with the server: a fee rule changed between this
 * page loading and Save. The gate reprices at confirm time and the gate wins.
 */
export function previewEntry(
  input: Pick<EntryInput,
    "transactionType" | "platform" | "amountPesos" | "amountIncludesFee" | "transferTo" | "platformFeePesos">,
  rules: readonly FeeRule[],
): EntryPreview {
  return quoteEntry(
    {
      transactionType: input.transactionType,
      platform: input.platform,
      amountMinor: toMinor(input.amountPesos),
      amountIncludesFee: input.amountIncludesFee,
      transferTo: input.transferTo ?? undefined,
      platformFeeMinor: toMinor(input.platformFeePesos ?? 0),
    },
    rules,
  );
}

export interface EntryResult {
  transactionId: string;
  entryId: string | null;
  /** False when the draft already existed — a replayed Save, not a second one. */
  created: boolean;
  feePesos: number;
}

/**
 * Save a typed transaction: create the draft, then confirm it.
 *
 * TWO CALLS, DELIBERATELY. `confirm-transaction` stays the only place the
 * ledger is written, so typed and photographed transactions converge on one
 * posting path with one copy of the arithmetic. A `create-and-post` route that
 * built its own legs would be a second implementation of the thing that was
 * wrong in four of the six original transaction types.
 *
 * The split is also better under failure. If the confirm leg fails — connection
 * dropped, fee rule missing — the draft survives at `awaiting_confirm` and
 * appears in the pending queue to be retried or discarded. An all-or-nothing
 * route would lose the operator's typing.
 *
 * ONE KEY FOR BOTH LEGS. `transactions.idempotency_key` dedupes the draft and
 * `ledger_entries.idempotency_key` dedupes the posting, so a retry of either
 * leg is a no-op that returns what the first attempt produced.
 */
export async function createAndConfirmTransaction(input: EntryInput): Promise<EntryResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;
  const headers = {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };

  // operator_id is never sent. Every endpoint resolves it from the verified
  // JWT; a caller-supplied operator id is the shape that caused Audit #5a.
  const createResponse = await fetch(`${base}/create-transaction`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      transaction_type: input.transactionType,
      platform: input.transactionType === "Profit Remittance" ? undefined : input.platform,
      amount: input.amountPesos,
      reference_number: input.referenceNumber ?? null,
      account_number: input.accountNumber ?? null,
      transaction_date: input.transactionDate ?? null,
      amount_includes_fee: input.amountIncludesFee === true,
      transfer_to: input.transactionType === "Wallet Transfer" ? input.transferTo ?? null : undefined,
      platform_fee: input.transactionType === "Wallet Transfer" ? input.platformFeePesos ?? 0 : undefined,
      idempotency_key: input.idempotencyKey,
      memo: input.memo ?? null,
    }),
  });

  const created = await createResponse.json();
  if (!createResponse.ok) {
    throw new Error(created.error ?? "Could not save the entry");
  }

  const transactionId: string = created.transaction?.id;
  if (!transactionId) throw new Error("The server did not return a transaction id");

  const confirmResponse = await fetch(`${base}/confirm-transaction`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      transaction_id: transactionId,
      idempotency_key: input.idempotencyKey,
      amount_includes_fee: input.amountIncludesFee === true,
    }),
  });

  const confirmed = await confirmResponse.json();
  if (!confirmResponse.ok) {
    // 409 means the draft is no longer awaiting confirmation, which on a retry
    // is the FIRST attempt having succeeded. Reported as success, because the
    // transaction is in the ledger and telling the operator it failed would
    // invite them to enter it a second time.
    if (confirmResponse.status === 409 && confirmed.status === "confirmed") {
      return {
        transactionId,
        entryId: null,
        created: created.created === true,
        feePesos: created.fee_preview ?? 0,
      };
    }
    throw new Error(
      `Saved as a draft, but confirming it failed: ${confirmed.error ?? "unknown error"}. ` +
        `It is waiting in your pending list.`,
    );
  }

  return {
    transactionId,
    entryId: confirmed.entry_id ?? null,
    created: created.created === true,
    feePesos: confirmed.net_profit ?? created.fee_preview ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------

export interface VoidResult {
  transactionId: string;
  /** The reversal entry; null when a draft was discarded (nothing was posted). */
  entryId: string | null;
}

/**
 * Void a transaction: reverse its ledger entry and mark it voided. For a draft
 * that was never confirmed, this discards it.
 *
 * Nothing is deleted. The original entry and its reversal both stay in the
 * ledger, which is what lets a balance be explained later. To correct a wrong
 * transaction, void it and enter it again.
 *
 * `idempotencyKey` must be stable across retries of one void (hold it in a
 * ref). The server treats "already voided" as success, so a retry after a lost
 * response does not report a failure for something that worked.
 */
export async function voidTransaction(input: {
  transactionId: string;
  idempotencyKey: string;
  reason?: string | null;
}): Promise<VoidResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/void-transaction`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction_id: input.transactionId,
        idempotency_key: input.idempotencyKey,
        reason: input.reason?.trim() || undefined,
      }),
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? "Could not void the transaction");
  }
  return { transactionId: input.transactionId, entryId: data.entry_id ?? null };
}

/** A fresh key for one money-moving action. Hold the result in a ref. */
export function newIdempotencyKey(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Wallets (platform accounts)
// ---------------------------------------------------------------------------

export interface PlatformAccountRow {
  id: string;
  name: string;
  kind: string;
  is_active: boolean;
}

async function callManagePlatform(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/manage-platform`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Could not update your wallets");
  return data;
}

/**
 * Add a wallet. It starts at zero; set its real balance from Settings →
 * Wallets, which posts the figure as a counted correction. A wallet that was
 * removed earlier comes back under the same name with its history.
 */
export async function addPlatform(name: string): Promise<PlatformAccountRow> {
  const data = await callManagePlatform({ action: "add", name });
  return data.account as PlatformAccountRow;
}

/** Remove a wallet from use. Refused while it still holds a balance. */
export async function retirePlatform(accountId: string): Promise<void> {
  await callManagePlatform({ action: "retire", account_id: accountId });
}

// ---------------------------------------------------------------------------
// Staff, and upload keys for sharing from a phone
// ---------------------------------------------------------------------------

async function callFunction(name: string, body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

export interface StaffMember {
  id: string;
  email: string;
  role: "staff";
  created_at?: string;
}

export async function listStaff(): Promise<{ ownerEmail: string | null; staff: StaffMember[] }> {
  const data = await callFunction("manage-staff", { action: "list" });
  return { ownerEmail: data.owner_email ?? null, staff: data.staff ?? [] };
}

/** Creates the person's login if needed and gives it staff access to this shop. */
export async function addStaff(email: string): Promise<StaffMember> {
  const data = await callFunction("manage-staff", { action: "add", email });
  return data.member as StaffMember;
}

/** Removes their access, their upload keys and their login. */
export async function removeStaff(memberId: string): Promise<void> {
  await callFunction("manage-staff", { action: "remove", member_id: memberId });
}

export interface UploadKey {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export async function listUploadKeys(): Promise<UploadKey[]> {
  const data = await callFunction("upload-keys", { action: "list" });
  return data.keys ?? [];
}

/** `key` is returned this once and cannot be shown again. */
export async function createUploadKey(label: string): Promise<{ key: string; record: UploadKey }> {
  const data = await callFunction("upload-keys", { action: "create", label });
  return { key: data.key as string, record: data.record as UploadKey };
}

export async function revokeUploadKey(keyId: string): Promise<void> {
  await callFunction("upload-keys", { action: "revoke", key_id: keyId });
}

/** Where a phone's share sheet sends screenshots. */
export const SHARE_UPLOAD_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/share-upload`;

// ---------------------------------------------------------------------------
// The shop's own numbers and accounts
// ---------------------------------------------------------------------------

export interface OwnIdentifierRow {
  id: string;
  account_id: string;
  kind: "mobile" | "account";
  value: string;
  label: string | null;
}

export interface WalletOption { id: string; name: string }

export async function listOwnIdentifiers(): Promise<{ identifiers: OwnIdentifierRow[]; wallets: WalletOption[] }> {
  const data = await callFunction("own-accounts", { action: "list" });
  return { identifiers: data.identifiers ?? [], wallets: data.wallets ?? [] };
}

/**
 * Tell the app that a mobile number or account number is the shop's own, and
 * which wallet it is. Receipts whose other side is that number are then read
 * as a transfer between wallets, not as a customer.
 */
export async function addOwnIdentifier(input: {
  accountId: string; kind: "mobile" | "account"; value: string; label?: string;
}): Promise<OwnIdentifierRow> {
  const data = await callFunction("own-accounts", {
    action: "add", account_id: input.accountId, kind: input.kind, value: input.value, label: input.label ?? null,
  });
  return data.identifier as OwnIdentifierRow;
}

export async function removeOwnIdentifier(id: string): Promise<void> {
  await callFunction("own-accounts", { action: "remove", identifier_id: id });
}
