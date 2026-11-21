/**
 * confirm-transaction — the confirmation gate.
 *
 * WHAT THIS REPLACES
 * Until 2026-09-23 this file was an *edit* endpoint. It accepted only
 * transactions that were already `confirmed` or `edited`, and the real
 * confirmation happened inside process-transaction, which inserted
 * `status: "confirmed"` and moved wallet balances in the same request as the
 * OCR call. The gate the PRD calls mandatory did not exist.
 *
 * That mattered because the unreliable part of this system is the OCR, not the
 * ledger. GPT-4o reading a PHP 1,850 Meralco bill as PHP 1,850,000 is a normal
 * failure with no cheap detector. Under auto-confirm that misread became a
 * posted entry, and because the ledger is append-only the only remedy is a
 * reversal that sits in the audit trail forever. This is the one place a human
 * sees the number before it becomes true.
 *
 * WHY IT IS CHEAP AGAIN
 * Auto-confirm was almost certainly introduced because confirming was
 * expensive: the old path went through an 18-argument
 * `confirm_transaction_atomic` carrying p_previous_platform_wallet /
 * p_next_platform_wallet pairs — a hand-rolled reversal engine. Confirming is
 * now "insert one balanced entry", so the pressure that removed the gate is gone.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import { resolveMembership } from "./_shared/operator.ts";
import { resolveRuleAt } from "./_shared/fee_rules.ts";
import { quoteEntry } from "../_core/entry.ts";
import { toMinor, toPesos } from "../_core/money.ts";
import { TRANSACTION_TYPES, isTransactionType } from "../_core/types.ts";
import type { FeeRule, Posting } from "../_core/types.ts";

interface RequestBody {
  transaction_id: string;
  /**
   * Required. A double-tapped confirm, a retry, or a lost response replays the
   * same key and `post_entry` returns the original entry instead of posting a
   * second one. Stronger than a status guard, which cannot help when the first
   * request SUCCEEDED and only the reply was lost.
   */
  idempotency_key: string;
  /** Corrections the operator made on the review screen. */
  edits?: {
    platform?: string;
    transaction_type?: string;
    amount?: number;
    account_number?: string | null;
    reference_number?: string | null;
    transaction_date?: string | null;
  };
  /**
   * The operator's answer to "does this figure already include your fee?".
   *
   * Never inferred. The old code guessed, and at 2% the gross of any whole peso
   * divides cleanly, so every amount divisible by 51 tripped it — 510, 1020,
   * 2040, 5100, each charged about a peso short. The number cannot tell you;
   * the person holding the receipt can.
   */
  amount_includes_fee?: boolean;
}

const MAX_AMOUNT_PESOS = 1_000_000;

export async function handleConfirmTransaction(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req, { error: "Missing authorization" }, 401);

    // Identity comes from the verified JWT. Nothing about the caller is taken
    // from the body — that is the shape that caused Audit #5a.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, db: { schema: "gocash" } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse(req, { error: "Unauthorized" }, 401);

    const membership = await resolveMembership(userClient);
    if (!membership) {
      return jsonResponse(req, { error: "Operator record not found" }, 404);
    }
    const operator = { id: membership.operatorId };

    const body: RequestBody = await req.json();
    if (!body.transaction_id) {
      return jsonResponse(req, { error: "transaction_id is required" }, 400);
    }
    if (!body.idempotency_key || body.idempotency_key.trim() === "") {
      return jsonResponse(req, { error: "idempotency_key is required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" } }
    );

    // ----- the transaction under review -----
    const { data: tx, error: txError } = await userClient
      .from("transactions")
      // One literal, not a concatenation: supabase-js parses this string at the
      // TYPE level, and a `+` defeats that, collapsing the row type to an error
      // union where every field access fails to compile.
      .select("id, operator_id, platform, transaction_type, amount, net_profit, account_number, reference_number, transaction_date, status, edit_history")
      .eq("id", body.transaction_id)
      .eq("operator_id", operator.id)   // belt and braces alongside RLS
      .single();

    if (txError || !tx) {
      return jsonResponse(req, { error: "Transaction not found" }, 404);
    }

    if (tx.status === "confirmed") {
      // A retry of a confirm that already succeeded (the reply was lost, or
      // the button was tapped twice) is a success, not an error. It is only
      // that if the SAME key posted THIS transaction; anything else is a
      // second confirmation and is refused.
      const { data: prior } = await admin
        .from("ledger_entries").select("id")
        .eq("operator_id", operator.id)
        .eq("transaction_id", tx.id)
        .eq("kind", "transaction")
        .eq("idempotency_key", body.idempotency_key)
        .maybeSingle();

      if (prior) {
        return jsonResponse(req, {
          transaction_id: tx.id,
          entry_id: prior.id,
          status: "confirmed",
          replayed: true,
          platform: tx.platform,
          transaction_type: tx.transaction_type,
          amount: tx.amount,
          net_profit: tx.net_profit,
        });
      }
    }

    if (tx.status !== "awaiting_confirm") {
      // Not retry-able: an already-confirmed transaction is corrected by
      // voiding and reposting, never by confirming twice.
      return jsonResponse(req, {
        error: `Transaction is ${tx.status}, not awaiting confirmation`,
        status: tx.status,
      }, 409);
    }

    // ----- apply the operator's corrections -----
    // These are free: the transaction is not in the ledger yet, so there is
    // nothing to reverse. Only edits made AFTER confirmation need a reversal.
    const edits = body.edits ?? {};
    const wasEdited = Object.keys(edits).length > 0;

    const platform = edits.platform ?? tx.platform;
    const txType = edits.transaction_type ?? tx.transaction_type;
    // `"amount" in edits`, not `??`. A client that sent NaN (which JSON turns
    // into null) used to fall back silently to the AI's figure; an amount the
    // operator supplied is either usable or refused.
    const amountPesos = "amount" in edits ? edits.amount : tx.amount;
    const accountNumber = "account_number" in edits ? edits.account_number : tx.account_number;
    const referenceNumber = "reference_number" in edits ? edits.reference_number : tx.reference_number;
    const transactionDate = "transaction_date" in edits ? edits.transaction_date : tx.transaction_date;

    if (!isTransactionType(txType)) {
      return jsonResponse(req, {
        error: `Invalid transaction_type. Allowed: ${TRANSACTION_TYPES.join(", ")}`,
      }, 400);
    }

    if (typeof amountPesos !== "number" || !isFinite(amountPesos)
        || amountPesos <= 0 || amountPesos > MAX_AMOUNT_PESOS) {
      // Zero is refused too. A draft whose amount could not be read is stored
      // as 0, and confirming it would post the minimum fee against nothing:
      // cash +5 / revenue -5, balanced and fictional.
      return jsonResponse(req, {
        error: `Enter the amount: it must be more than 0 and at most ${MAX_AMOUNT_PESOS}`,
        code: "invalid_amount",
      }, 400);
    }

    // The platform must be one this operator actually holds an account for.
    // The old code fell back to "GCash" whenever the platform was Unknown,
    // silently attributing a transaction to a wallet the operator might not
    // even have. Unknown now means the gate asks.
    if (txType !== "Profit Remittance") {
      const { data: account } = await admin
        .from("accounts").select("id")
        .eq("operator_id", operator.id).eq("kind", "platform")
        .eq("name", platform).eq("is_active", true).maybeSingle();

      if (!account) {
        return jsonResponse(req, {
          error: `No active account for platform "${platform}". ` +
                 `Pick the platform this transaction went through.`,
          code: "unknown_platform",
        }, 422);
      }
    }

    // ----- price it -----
    // At the rule in force on the TRANSACTION's date, not today's. fee_rules
    // are effective-dated precisely so amending an old transaction later does
    // not silently reprice it at the current rate.
    const pricedAt = transactionDate ?? new Date().toISOString();
    const rule = await resolveRuleAt(admin, operator.id, txType, platform, pricedAt);

    if (!rule) {
      return jsonResponse(req, {
        error: `No fee rule for "${txType}" on "${platform}" as at ${pricedAt}`,
        code: "no_fee_rule",
      }, 422);
    }

    // ----- price it and build the entry -----
    // One call, shared with create-transaction and the entry form, so the
    // figure the operator saw on the form is produced by the same code that
    // posts it rather than by a second implementation that agrees today.
    const amountMinor = toMinor(amountPesos);
    let feeMinor: number;
    let postings: Posting[];
    try {
      const quote = quoteEntry(
        {
          transactionType: txType,
          platform,
          amountMinor,
          amountIncludesFee: body.amount_includes_fee === true,
        },
        [rule],
      );
      feeMinor = quote.feeMinor;
      postings = quote.postings;
    } catch (err) {
      // _core refuses nonsensical entries — a negative amount, or a Cash Out
      // whose fee exceeds the payout. Those are 422s, not 500s: the request was
      // well-formed, the numbers were not.
      return jsonResponse(req, {
        error: err instanceof Error ? err.message : "Could not build ledger entry",
        code: "unpostable",
      }, 422);
    }

    const legs = postings.map((p) => (
      p.account.kind === "platform"
        ? { kind: "platform", platform: p.account.platform, amount_minor: p.amount }
        : { kind: p.account.kind, amount_minor: p.amount }
    ));

    // ----- post and mark confirmed, atomically -----
    // One database transaction (gocash.confirm_transaction): the row is
    // locked, the entry is posted and the status changes together. Doing these
    // as separate calls from here let two confirms with different keys both
    // post, and let a failed status update leave a draft that could be posted
    // again.
    const now = new Date().toISOString();

    const { data: result, error: confirmError } = await admin.rpc("confirm_transaction", {
      p_operator_id: operator.id,
      p_transaction_id: tx.id,
      p_legs: legs,
      p_fields: {
        platform,
        transaction_type: txType,
        amount: amountPesos,
        net_profit: toPesos(feeMinor),
        account_number: accountNumber ?? null,
        reference_number: referenceNumber ?? null,
        transaction_date: transactionDate ?? null,
        was_edited: wasEdited,
        ...(wasEdited
          ? {
              edit_record: {
                edited_at: now,
                edited_by: user.id,
                changes: edits,
                previous: {
                  platform: tx.platform,
                  transaction_type: tx.transaction_type,
                  amount: tx.amount,
                  account_number: tx.account_number,
                  reference_number: tx.reference_number,
                  transaction_date: tx.transaction_date,
                },
              },
            }
          : {}),
      },
      p_idempotency_key: body.idempotency_key,
      p_created_by: user.id,
      p_memo: `${txType} ${platform}`,
    });

    if (confirmError) {
      // GC001: another confirm got there first. GC002/GC003: the key or the
      // transaction already has an entry. All three mean "do not post again".
      if (confirmError.code === "GC001" || confirmError.code === "GC003") {
        return jsonResponse(req, {
          error: "Transaction is already confirmed",
          status: "confirmed",
        }, 409);
      }
      if (confirmError.code === "GC002") {
        return jsonResponse(req, {
          error: "This confirmation key was already used for another transaction",
          code: "key_reused",
        }, 409);
      }
      // 23505 on the reference index: an edited reference number collides
      // with another of this operator's transactions.
      if (confirmError.code === "23505"
          && confirmError.message.includes("transactions_unique_reference_per_operator")) {
        return jsonResponse(req, {
          error: "Another transaction already has this reference number",
          code: "duplicate_reference",
        }, 409);
      }
      console.error("confirm_transaction failed:", confirmError.code, confirmError.message);
      return jsonResponse(req, { error: "Could not post the ledger entry" }, 500);
    }

    const entryId = (result as { entry_id: string }).entry_id;

    return jsonResponse(req, {
      transaction_id: tx.id,
      entry_id: entryId,
      status: "confirmed",
      platform,
      transaction_type: txType,
      amount: amountPesos,
      net_profit: toPesos(feeMinor),
      was_edited: wasEdited,
      postings: postings.map((p) => ({
        account: p.account.kind === "platform" ? p.account.platform : p.account.kind,
        amount: toPesos(p.amount),
      })),
    });
  } catch (err) {
    console.error("Unhandled error in confirm-transaction:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}
