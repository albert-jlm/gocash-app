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
import { calculateFee } from "../_core/fees.ts";
import { buildPostings } from "../_core/postings.ts";
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

    const { data: operator, error: opError } = await userClient
      .from("operators").select("id").eq("user_id", user.id).single();

    if (opError || !operator) {
      return jsonResponse(req, { error: "Operator record not found" }, 404);
    }

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
      .select("id, operator_id, platform, transaction_type, amount, account_number, reference_number, transaction_date, status, edit_history")
      .eq("id", body.transaction_id)
      .eq("operator_id", operator.id)   // belt and braces alongside RLS
      .single();

    if (txError || !tx) {
      return jsonResponse(req, { error: "Transaction not found" }, 404);
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
    const amountPesos = edits.amount ?? tx.amount;
    const accountNumber = "account_number" in edits ? edits.account_number : tx.account_number;
    const referenceNumber = "reference_number" in edits ? edits.reference_number : tx.reference_number;
    const transactionDate = "transaction_date" in edits ? edits.transaction_date : tx.transaction_date;

    if (!isTransactionType(txType)) {
      return jsonResponse(req, {
        error: `Invalid transaction_type. Allowed: ${TRANSACTION_TYPES.join(", ")}`,
      }, 400);
    }

    if (typeof amountPesos !== "number" || !isFinite(amountPesos)
        || amountPesos < 0 || amountPesos > MAX_AMOUNT_PESOS) {
      return jsonResponse(req, {
        error: `Invalid amount: must be a number between 0 and ${MAX_AMOUNT_PESOS}`,
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

    const amountMinor = toMinor(amountPesos);
    const feeMinor = calculateFee(txType, platform, amountMinor, [rule], {
      amountIncludesFee: body.amount_includes_fee === true,
    });

    // ----- build the entry -----
    let postings: Posting[];
    try {
      postings = buildPostings(txType, { amountMinor, feeMinor, platform });
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

    // ----- post, then mark confirmed -----
    // Order matters. post_entry is idempotent on the key, so if the status
    // update below fails the client can retry safely: the entry replays as a
    // no-op and the update is re-attempted. The reverse order would leave a
    // transaction marked confirmed with no entry behind it.
    const { data: entryId, error: postError } = await admin.rpc("post_entry", {
      p_operator_id: operator.id,
      p_kind: "transaction",
      p_legs: legs,
      p_transaction_id: tx.id,
      p_memo: `${txType} ${platform}`,
      p_idempotency_key: body.idempotency_key,
      p_created_by: user.id,
    });

    if (postError) {
      console.error("post_entry failed:", postError.message);
      return jsonResponse(req, { error: "Could not post the ledger entry" }, 500);
    }

    const now = new Date().toISOString();
    const history = Array.isArray(tx.edit_history) ? tx.edit_history : [];

    const { error: updateError } = await admin
      .from("transactions")
      .update({
        platform,
        transaction_type: txType,
        amount: amountPesos,
        net_profit: toPesos(feeMinor),
        account_number: accountNumber,
        reference_number: referenceNumber,
        transaction_date: transactionDate,
        status: "confirmed",
        confirmed_at: now,
        confirmed_by: user.id,
        was_edited: wasEdited,
        edit_history: wasEdited
          ? [...history, {
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
            }]
          : history,
      })
      .eq("id", tx.id)
      .eq("operator_id", operator.id);

    if (updateError) {
      console.error("Entry posted but transaction update failed:", updateError.message);
      return jsonResponse(req, {
        error: "Ledger entry posted but the transaction could not be marked confirmed. " +
               "Retry with the same idempotency_key.",
        entry_id: entryId,
      }, 500);
    }

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

/**
 * The fee rule in force for this type/platform at a given instant.
 *
 * Mirrors resolveFeeRule in _core/fees.ts: an exact platform match wins over
 * the "all" fallback, so a generic rule can never silently override
 * platform-specific pricing. gocash.fee_rule_at() matches one platform exactly,
 * so the fallback is a second call rather than a clever query.
 */
async function resolveRuleAt(
  // deno-lint-ignore no-explicit-any
  admin: any,
  operatorId: string,
  txType: string,
  platform: string,
  at: string
): Promise<FeeRule | null> {
  for (const candidate of [platform, "all"]) {
    const { data } = await admin.rpc("fee_rule_at", {
      p_operator_id: operatorId,
      p_transaction_type: txType,
      p_platform: candidate,
      p_at: at,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.id) {
      return {
        transaction_type: row.transaction_type,
        platform: row.platform,
        rate_bps: Number(row.rate_bps),
        minimum_minor: Number(row.minimum_minor),
        is_active: true,
      };
    }
  }
  return null;
}
