/**
 * reconcile-account — the nightly drawer count.
 *
 * WHAT THIS REPLACES
 * Settings → Wallets used to issue `UPDATE gocash.wallets SET balance = ...`
 * straight from the browser: a balance overwrite that left no trace of what was
 * changed, by how much, or why (AUDITS.md #5 finding 14). In a money-handling
 * app that meant an operator could never tell whether they were short or the
 * app was wrong — the two look identical once the number has been typed over.
 *
 * With derived balances that write is not merely untracked, it is impossible:
 * `gocash.account_balances` is the SUM of `gocash.postings`, and the browser is
 * granted SELECT and nothing else. The correction therefore has to become a
 * posting, and a posting stays visible forever.
 *
 * THE ARITHMETIC IS NOT HERE
 * The legs come from `reconcile()` in `../_core/postings.ts`, the same module
 * `src/lib/ledger.ts` previews with, so the operator sees exactly the entry that
 * gets written. A second copy of "difference on the counted account, inverse on
 * equity" living in this file is precisely AUDITS.md #5 finding 4.
 *
 * THE BOOK BALANCE IS NOT TAKEN FROM THE CLIENT
 * It is read from `account_balances` inside this request. A client-supplied book
 * balance would mean the operator's browser decides how much to adjust by, so a
 * page left open while transactions were confirmed elsewhere would post a
 * correction computed against a balance that no longer exists — silently moving
 * money by the amount of the staleness.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import { resolveMembership, refuseUnlessOwner } from "./_shared/operator.ts";
import { LedgerError, reconcile } from "../_core/postings.ts";
import { toMinor, toPesos, type Minor } from "../_core/money.ts";
import type { AccountKind, AccountRef, Posting } from "../_core/types.ts";

interface RequestBody {
  account_id: string;
  /** What the operator counted, in pesos, as typed into the form. */
  counted_pesos?: number;
  /** Or the exact centavo integer, for a caller that already has one. */
  counted_minor?: number;
  memo?: string;
  /** See deriveIdempotencyKey() — supply one; a fallback is derived if absent. */
  idempotency_key?: string;
}

/**
 * Only a countable account can be reconciled.
 *
 * `revenue` is derived from the fees on every entry; a hand-typed "I counted
 * PHP 812 of fees earned" is not a count of anything and would silently move
 * the figure the operator's income is read from. `equity` is the OTHER LEG of
 * every correction, so reconciling it against itself would produce an entry
 * whose two legs are the same account — a net zero that `balanced()` accepts
 * and that means nothing.
 */
const COUNTABLE_KINDS: readonly AccountKind[] = ["cash", "platform"];

/**
 * Matches the `abs(amount_minor) <= 10000000000` CHECK on gocash.postings
 * (PHP 100,000,000). Rejected here so an implausible count comes back as a 400
 * naming the field rather than a 500 from a constraint violation.
 */
const MAX_BALANCE_MINOR = 10_000_000_000;

/** BIGINT columns can arrive as a JSON number or a string; both must be exact. */
function asMinor(value: unknown, label: string): Minor {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n)) {
    throw new LedgerError(`${label} is not an exact centavo integer: ${String(value)}`);
  }
  return n;
}

/** The `AccountRef` shape `_core/postings.ts` builds legs against. */
function accountRef(account: { kind: AccountKind; name: string }): AccountRef {
  return account.kind === "platform"
    ? { kind: "platform", platform: account.name }
    : { kind: account.kind as "cash" | "revenue" | "equity" };
}

/** A posting as `gocash.post_entry` wants its legs: by account KIND, never id. */
function toLeg(posting: Posting): Record<string, unknown> {
  return posting.account.kind === "platform"
    ? {
        kind: "platform",
        platform: posting.account.platform,
        amount_minor: posting.amount,
      }
    : { kind: posting.account.kind, amount_minor: posting.amount };
}

/**
 * Fallback idempotency key.
 *
 * A key from the CLIENT is better, because only the client knows that two
 * requests are the same user action; it should send one. This exists so that a
 * caller that forgets still cannot double-post on a double tap, which is the
 * failure this guard is actually for.
 *
 * The key names the exact state transition being posted — this account, from
 * this book balance, to this count — so two taps of the same button collapse
 * to one entry even when they race and both read the same book balance. The
 * date is in it because that transition can legitimately recur: an account can
 * drift back to the same book balance and be counted at the same figure again
 * on another day, and without the date the second, genuine correction would be
 * swallowed as a replay. Within one UTC day an exact repeat still replays; the
 * response says `replayed: true` rather than pretending it posted.
 */
function deriveIdempotencyKey(
  accountId: string,
  bookMinor: Minor,
  countedMinor: Minor,
): string {
  const day = new Date().toISOString().slice(0, 10);
  return `auto:reconcile:${accountId}:${bookMinor}:${countedMinor}:${day}`;
}

export async function handleReconcileAccount(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req, { error: "Missing authorization" }, 401);

    // Identity comes from the caller's own JWT, never from the body. The body
    // may carry an operator_id; it is not read, because a caller-supplied
    // operator id is the cross-tenant write AUDITS.md #5a was about.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
        db: { schema: "gocash" },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) return jsonResponse(req, { error: "Unauthorized" }, 401);

    const membership = await resolveMembership(userClient);
    if (!membership) {
      return jsonResponse(req, { error: "Operator record not found" }, 404);
    }
    const operator = { id: membership.operatorId };
    const refusal = refuseUnlessOwner(req, membership);
    if (refusal) return refusal;

    let body: RequestBody;
    try {
      body = await req.json() as RequestBody;
    } catch {
      return jsonResponse(req, { error: "Request body must be JSON" }, 400);
    }

    if (!body.account_id || typeof body.account_id !== "string") {
      return jsonResponse(req, { error: "account_id is required" }, 400);
    }

    // Exactly one of the two spellings of the count. Accepting both at once
    // would mean picking a winner, and a disagreement between them is a bug in
    // the caller that should be reported, not resolved.
    const hasPesos = body.counted_pesos !== undefined && body.counted_pesos !== null;
    const hasMinor = body.counted_minor !== undefined && body.counted_minor !== null;

    if (hasPesos && hasMinor) {
      return jsonResponse(
        req,
        { error: "Send counted_pesos or counted_minor, not both" },
        400,
      );
    }
    if (!hasPesos && !hasMinor) {
      return jsonResponse(req, { error: "counted_pesos is required" }, 400);
    }

    let countedMinor: Minor;
    if (hasMinor) {
      if (
        typeof body.counted_minor !== "number" ||
        !Number.isSafeInteger(body.counted_minor)
      ) {
        return jsonResponse(
          req,
          { error: "counted_minor must be an integer number of centavos" },
          400,
        );
      }
      countedMinor = body.counted_minor;
    } else {
      if (typeof body.counted_pesos !== "number" || !Number.isFinite(body.counted_pesos)) {
        return jsonResponse(req, { error: "counted_pesos must be a finite number" }, 400);
      }
      // Pesos as typed -> exact centavos, by the same rounding the preview on
      // the form used, so the difference shown and the difference posted agree.
      countedMinor = toMinor(body.counted_pesos);
    }

    if (countedMinor < 0) {
      return jsonResponse(req, { error: "A counted balance cannot be negative" }, 400);
    }
    if (countedMinor > MAX_BALANCE_MINOR) {
      return jsonResponse(
        req,
        { error: `A counted balance above ${toPesos(MAX_BALANCE_MINOR)} pesos is not accepted` },
        400,
      );
    }

    if (body.memo !== undefined && body.memo !== null && typeof body.memo !== "string") {
      return jsonResponse(req, { error: "memo must be a string" }, 400);
    }
    if (
      body.idempotency_key !== undefined && body.idempotency_key !== null &&
      (typeof body.idempotency_key !== "string" || body.idempotency_key.length > 255)
    ) {
      return jsonResponse(
        req,
        { error: "idempotency_key must be a string of at most 255 characters" },
        400,
      );
    }

    // -----------------------------------------------------------------------
    // The book balance, read server-side, through the CALLER's client.
    //
    // account_balances is security_invoker, so this row comes back only if RLS
    // says the account is the caller's. The explicit operator_id filter is the
    // ownership check stated rather than implied: an account_id from the body
    // that belongs to someone else returns no row and 404s here, and never
    // reaches post_entry.
    // -----------------------------------------------------------------------
    const { data: account, error: balanceError } = await userClient
      .from("account_balances")
      .select("account_id, name, kind, currency, balance_minor")
      .eq("account_id", body.account_id)
      .eq("operator_id", operator.id)
      .maybeSingle();

    if (balanceError) {
      console.error("Failed to read account balance:", balanceError.message);
      return jsonResponse(req, { error: "Failed to read the account balance" }, 500);
    }
    if (!account) {
      return jsonResponse(req, { error: "Account not found or access denied" }, 404);
    }

    const accountKind = account.kind as AccountKind;
    if (!COUNTABLE_KINDS.includes(accountKind)) {
      return jsonResponse(
        req,
        {
          error: `A ${accountKind} account cannot be reconciled — only cash and ` +
            `platform accounts hold something countable. ` +
            (accountKind === "revenue"
              ? "Revenue is derived from the fees on every entry."
              : "Equity is the balancing leg of every correction."),
        },
        422,
      );
    }

    let bookMinor: Minor;
    try {
      bookMinor = asMinor(account.balance_minor, "balance_minor");
    } catch (err) {
      console.error("Unusable book balance:", err instanceof Error ? err.message : err);
      return jsonResponse(req, { error: "The stored book balance is unusable" }, 500);
    }

    const differenceMinor = countedMinor - bookMinor;

    // -----------------------------------------------------------------------
    // A perfect count.
    //
    // reconcile() -> balanced() THROWS here, deliberately: an entry with a zero
    // difference has nothing to say and is not a valid entry. That is correct
    // as a library rule and wrong as an HTTP status — the operator did nothing
    // wrong, they counted and it matched. Caught by value before the call
    // rather than by catching the LedgerError, so a genuinely malformed entry
    // is never mistaken for a clean drawer.
    // -----------------------------------------------------------------------
    if (differenceMinor === 0) {
      return jsonResponse(req, {
        posted: false,
        replayed: false,
        entry_id: null,
        account_id: account.account_id,
        account_name: account.name,
        kind: accountKind,
        difference_minor: 0,
        difference: 0,
        book_balance_minor: bookMinor,
        counted_balance_minor: countedMinor,
        balance_minor: bookMinor,
        balance: toPesos(bookMinor),
        message: "The count matches the ledger — nothing to post.",
      });
    }

    let legs: Posting[];
    try {
      legs = reconcile({
        account: accountRef({ kind: accountKind, name: account.name }),
        bookBalanceMinor: bookMinor,
        countedBalanceMinor: countedMinor,
      });
    } catch (err) {
      if (err instanceof LedgerError) {
        return jsonResponse(req, { error: err.message }, 400);
      }
      throw err;
    }

    const idempotencyKey = body.idempotency_key ??
      deriveIdempotencyKey(account.account_id, bookMinor, countedMinor);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" } },
    );

    // Was this key already used? post_entry replays it as a no-op and returns
    // the original id either way — this is only so the response can say which
    // happened, instead of reporting a fresh posting that did not occur.
    const { data: priorEntry } = await adminClient
      .from("ledger_entries")
      .select("id")
      .eq("operator_id", operator.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    const { data: entryId, error: postError } = await adminClient.rpc("post_entry", {
      p_operator_id: operator.id,
      p_kind: "reconciliation",
      p_legs: legs.map(toLeg),
      p_transaction_id: null,
      p_memo: body.memo ?? "Drawer count",
      p_idempotency_key: idempotencyKey,
      p_created_by: user.id,
      p_reverses: null,
    });

    if (postError || !entryId) {
      console.error("post_entry failed for reconciliation:", postError?.message);
      return jsonResponse(
        req,
        { error: "Failed to post the correction", detail: postError?.message },
        500,
      );
    }

    // Re-read rather than computing bookMinor + differenceMinor. The point of a
    // derived balance is that it is read from the postings; asserting what it
    // ought to be would reintroduce a second notion of the balance, which is
    // the whole defect being removed here.
    const { data: after } = await adminClient
      .from("account_balances")
      .select("balance_minor, balance, natural_balance, posting_count, last_posted_at")
      .eq("account_id", account.account_id)
      .eq("operator_id", operator.id)
      .maybeSingle();

    const newBalanceMinor = after ? asMinor(after.balance_minor, "balance_minor") : countedMinor;

    return jsonResponse(req, {
      posted: !priorEntry,
      replayed: Boolean(priorEntry),
      entry_id: entryId,
      account_id: account.account_id,
      account_name: account.name,
      kind: accountKind,
      difference_minor: differenceMinor,
      difference: toPesos(differenceMinor),
      book_balance_minor: bookMinor,
      counted_balance_minor: countedMinor,
      balance_minor: newBalanceMinor,
      balance: toPesos(newBalanceMinor),
      natural_balance: after?.natural_balance ?? null,
      idempotency_key: idempotencyKey,
      legs: legs.map(toLeg),
    });
  } catch (err) {
    console.error("Unhandled error in reconcile-account:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}
