/**
 * create-transaction — record a transaction by typing it.
 *
 * WHY THIS EXISTS
 * Before this route the only way into the ledger was `process-transaction`,
 * which rejects any request without `image_base64`. A screenshot was not the
 * convenient path, it was the only path: no screenshot, no record. That made a
 * vision model load-bearing for a shop counter, and it meant a dropped
 * connection, a cropped receipt, or a platform whose app does not expose a
 * share sheet simply could not be recorded at all.
 *
 * WHAT IT DOES NOT DO
 * It does not write the ledger. It inserts a DRAFT at 'awaiting_confirm' and
 * stops. `confirm-transaction` remains the only place money moves, so typed and
 * read transactions converge on one posting path with one copy of the
 * arithmetic — the alternative being a second route that builds its own legs,
 * which is how four of the six original transaction types ended up wrong.
 *
 * The fee it returns is therefore a PREVIEW. It is computed with the same
 * `calculateFee` and the same `resolveRuleAt` the gate uses, so it will agree in
 * every normal case, but the gate reprices at confirm time and the gate wins.
 * Labelled `fee_preview` rather than `fee` for that reason.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import { resolveRuleAt } from "./_shared/fee_rules.ts";
import { quoteEntry } from "../_core/entry.ts";
import { LedgerError } from "../_core/postings.ts";
import { toMinor, toPesos } from "../_core/money.ts";
import { TRANSACTION_TYPES, isTransactionType } from "../_core/types.ts";
import type { Posting } from "../_core/types.ts";

interface RequestBody {
  transaction_type: string;
  /** Omitted for Profit Remittance, which touches no platform. */
  platform?: string;
  /** Pesos, as typed. Converted to exact centavos here. */
  amount: number;
  reference_number?: string | null;
  account_number?: string | null;
  /** ISO 8601. Defaults to now — a transaction typed at the counter is current. */
  transaction_date?: string | null;
  /** Cash Out only; see FeeOptions in _core/fees.ts. */
  amount_includes_fee?: boolean;
  /**
   * Required. Stable across retries of ONE Save tap.
   *
   * post_entry already makes a duplicate confirm harmless. A duplicate DRAFT is
   * not: two rows at 'awaiting_confirm' describing one real transaction, which
   * the operator cannot tell apart and confirms both of, posting twice. The
   * reference-number index does not cover it because a typed transaction often
   * has no reference number and UNIQUE treats NULLs as distinct.
   */
  idempotency_key: string;
  memo?: string | null;
}

const MAX_AMOUNT_PESOS = 1_000_000;

export async function handleCreateTransaction(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req, { error: "Missing authorization" }, 401);

    // Identity from the verified JWT only. Nothing about the caller is read
    // from the body — a caller-supplied operator_id is what Audit #5a was.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, db: { schema: "gocash" } },
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse(req, { error: "Unauthorized" }, 401);

    const { data: operator, error: opError } = await userClient
      .from("operators").select("id").eq("user_id", user.id).single();

    if (opError || !operator) {
      return jsonResponse(req, { error: "Operator record not found" }, 404);
    }

    let body: RequestBody;
    try {
      body = await req.json() as RequestBody;
    } catch {
      return jsonResponse(req, { error: "Request body must be JSON" }, 400);
    }

    // ----- validate -----
    if (!body.idempotency_key || typeof body.idempotency_key !== "string"
        || body.idempotency_key.trim() === "" || body.idempotency_key.length > 255) {
      return jsonResponse(req, {
        error: "idempotency_key is required (1-255 characters)",
      }, 400);
    }
    const idempotencyKey = body.idempotency_key.trim();

    // `transactions.transaction_type` also permits 'Unknown' at the database
    // level, because OCR can fail to identify a receipt. isTransactionType does
    // not, and that asymmetry is right here: a person typing this form knows
    // what they just did, and an 'Unknown' draft is one the gate then refuses
    // to price.
    const txType = body.transaction_type;
    if (!isTransactionType(txType)) {
      return jsonResponse(req, {
        error: `transaction_type must be one of: ${TRANSACTION_TYPES.join(", ")}`,
      }, 400);
    }

    if (typeof body.amount !== "number" || !Number.isFinite(body.amount)) {
      return jsonResponse(req, { error: "amount must be a number of pesos" }, 400);
    }
    // Zero is rejected, unlike at the gate. The gate tolerates it because an OCR
    // misread can legitimately produce 0 and the operator corrects it there; a
    // person typing 0 into this form has not recorded anything.
    if (body.amount <= 0) {
      return jsonResponse(req, { error: "amount must be greater than zero" }, 400);
    }
    if (body.amount > MAX_AMOUNT_PESOS) {
      return jsonResponse(req, {
        error: `amount must be at most ${MAX_AMOUNT_PESOS} pesos`,
      }, 400);
    }

    // Profit Remittance moves cash to the owner and touches no platform wallet,
    // so a platform on it would be recorded and never used — a value in the
    // database that means nothing is worse than a missing one.
    const needsPlatform = txType !== "Profit Remittance";
    let platform = "Unknown";

    if (needsPlatform) {
      if (!body.platform || typeof body.platform !== "string" || body.platform.trim() === "") {
        return jsonResponse(req, {
          error: `platform is required for ${txType}`,
          code: "platform_required",
        }, 400);
      }
      platform = body.platform.trim();
    }

    for (const [field, value] of Object.entries({
      reference_number: body.reference_number,
      account_number: body.account_number,
      memo: body.memo,
    })) {
      if (value !== undefined && value !== null && typeof value !== "string") {
        return jsonResponse(req, { error: `${field} must be a string` }, 400);
      }
    }

    let transactionDate: string;
    if (body.transaction_date) {
      const parsed = new Date(body.transaction_date);
      if (Number.isNaN(parsed.getTime())) {
        return jsonResponse(req, { error: "transaction_date is not a valid date" }, 400);
      }
      transactionDate = parsed.toISOString();
    } else {
      transactionDate = new Date().toISOString();
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" } },
    );

    // ----- the platform must be one this operator holds -----
    // Checked here as well as at the gate so the operator is told at entry time
    // rather than after they tap Save. The gate's check stays: this one is for
    // the message, that one is the control.
    if (needsPlatform) {
      const { data: account } = await admin
        .from("accounts").select("id")
        .eq("operator_id", operator.id).eq("kind", "platform")
        .eq("name", platform).eq("is_active", true).maybeSingle();

      if (!account) {
        return jsonResponse(req, {
          error: `No active account for platform "${platform}".`,
          code: "unknown_platform",
        }, 422);
      }
    }

    // ----- price it, as a preview -----
    const rule = await resolveRuleAt(admin, operator.id, txType, platform, transactionDate);
    if (!rule) {
      return jsonResponse(req, {
        error: `No fee rule for "${txType}" on "${platform}" as at ${transactionDate}`,
        code: "no_fee_rule",
      }, 422);
    }

    // Priced and built in one call, by the same `quoteEntry` the gate and the
    // entry form run. Doing the three steps inline here would be a third copy
    // of a sequence where the fee feeds the legs.
    //
    // Done BEFORE inserting anything: an input the ledger would refuse — a Cash
    // Out whose fee exceeds the amount, say — should come back as a 422 naming
    // the problem, not as a draft that sits in the queue and fails every time
    // the operator tries to confirm it.
    const amountMinor = toMinor(body.amount);
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
      if (err instanceof LedgerError) {
        return jsonResponse(req, { error: err.message, code: "unpostable" }, 422);
      }
      throw err;
    }

    // ----- insert the draft -----
    const reference = body.reference_number?.trim() || null;

    const { data: created, error: insertError } = await admin
      .from("transactions")
      .insert({
        operator_id: operator.id,
        transaction_type: txType,
        platform,
        amount: body.amount,
        net_profit: toPesos(feeMinor),
        account_number: body.account_number?.trim() || null,
        reference_number: reference,
        transaction_date: transactionDate,
        status: "awaiting_confirm",
        entry_source: "manual",
        idempotency_key: idempotencyKey,
        image_url: null,
      })
      .select("id, transaction_type, platform, amount, reference_number, transaction_date, status")
      .single();

    if (insertError) {
      // 23505 = unique_violation. Two indexes can raise it and they mean
      // different things, so they get different answers.
      if (insertError.code === "23505") {
        const { data: existing } = await admin
          .from("transactions")
          .select("id, transaction_type, platform, amount, reference_number, transaction_date, status")
          .eq("operator_id", operator.id)
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();

        // Same Save tap, retried. Return the draft that already exists: the
        // caller gets the id it needs to confirm, and no second row appears.
        if (existing) {
          return jsonResponse(req, {
            created: false,
            replayed: true,
            transaction: existing,
            fee_preview: toPesos(feeMinor),
            fee_preview_minor: feeMinor,
            postings: previewPostings(postings),
            message: "This entry was already saved; returning the existing draft.",
          });
        }

        // A DIFFERENT transaction with the same reference number. This is the
        // duplicate-receipt defence working, and it is worth a clear message
        // because at the counter the usual cause is recording the same receipt
        // twice rather than a bug.
        if (reference) {
          return jsonResponse(req, {
            error: `Reference number ${reference} is already recorded.`,
            code: "duplicate_reference",
          }, 409);
        }
      }

      console.error("Draft insert failed:", insertError.message);
      return jsonResponse(req, {
        error: "Failed to save the entry",
        detail: insertError.message,
      }, 500);
    }

    return jsonResponse(req, {
      created: true,
      replayed: false,
      transaction: created,
      fee_preview: toPesos(feeMinor),
      fee_preview_minor: feeMinor,
      // What confirming will do to each balance. Shown so the operator sees the
      // effect before it happens, which is the whole point of the gate.
      postings: previewPostings(postings),
      // The caller confirms with this same key. post_entry dedupes on it, so a
      // retry of the confirm cannot post twice either.
      idempotency_key: idempotencyKey,
      next: "confirm-transaction",
    }, 201);
  } catch (err) {
    console.error("Unhandled error in create-transaction:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}

function previewPostings(postings: readonly Posting[]) {
  return postings.map((p) => ({
    account: p.account.kind === "platform" ? p.account.platform : p.account.kind,
    amount: toPesos(p.amount),
    amount_minor: p.amount,
  }));
}
