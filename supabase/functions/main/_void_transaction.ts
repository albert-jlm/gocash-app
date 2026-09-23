/**
 * void-transaction — undo a confirmed transaction.
 *
 * WHAT THIS REPLACES
 * `_delete_transaction.ts`, which called `delete_transaction_atomic`. That RPC
 * is dropped by 20260924000006 and could not survive anyway: the ledger tables
 * reject DELETE, so there is nothing for it to delete.
 *
 * It also leaked. The served handler called the SIX-argument overload, which
 * passes NULL for the receipt bucket and path, so nothing was ever enqueued for
 * deletion — a review found six storage objects against one surviving
 * transaction. The eight-argument overload did the enqueue and was never
 * reachable.
 *
 * VOIDING, NOT DELETING
 * A ledger you can delete from is not a ledger. The correction is a reversal
 * entry: every leg of the original, negated. Both entries stay forever, which
 * is what makes "why is my GCash balance 5,550?" answerable.
 *
 * The legs are read back from the ORIGINAL POSTINGS rather than recomputed from
 * the transaction row. If the transaction was edited, or the fee rule has since
 * changed, recomputing would produce a reversal that does not actually cancel
 * what was posted — and the books would not return to where they started.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import { TRANSACTION_IMAGE_BUCKET } from "./_shared/storage.ts";

interface RequestBody {
  transaction_id: string;
  /** Required — a double-tapped void must not post two reversals. */
  idempotency_key: string;
  /** Shown in the ledger. Worth requiring: a void with no stated reason is a mystery later. */
  reason?: string;
}

export async function handleVoidTransaction(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req, { error: "Missing authorization" }, 401);

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

    const { data: tx, error: txError } = await userClient
      .from("transactions")
      .select("id, status, image_url")
      .eq("id", body.transaction_id)
      .eq("operator_id", operator.id)
      .single();

    if (txError || !tx) return jsonResponse(req, { error: "Transaction not found" }, 404);

    if (tx.status === "voided") {
      return jsonResponse(req, { error: "Transaction is already voided", status: tx.status }, 409);
    }

    // An awaiting_confirm transaction has no entry to reverse — nothing was
    // ever posted. Mark it voided and stop; posting a reversal of nothing would
    // fail the two-leg minimum anyway.
    if (tx.status === "awaiting_confirm") {
      await admin.from("transactions").update({ status: "voided" })
        .eq("id", tx.id).eq("operator_id", operator.id);
      await enqueueReceipt(admin, tx.image_url);
      return jsonResponse(req, {
        transaction_id: tx.id, status: "voided", entry_id: null,
        note: "Nothing was posted for this transaction, so there was nothing to reverse.",
      });
    }

    if (tx.status !== "confirmed") {
      return jsonResponse(req, {
        error: `Cannot void a transaction that is ${tx.status}`, status: tx.status,
      }, 409);
    }

    // The entry to reverse. `ledger_entries_one_reversal` already makes a
    // second reversal impossible at the database level; checking here turns
    // that into a clear 409 rather than a constraint violation.
    const { data: entry, error: entryError } = await admin
      .from("ledger_entries")
      .select("id")
      .eq("transaction_id", tx.id)
      .eq("kind", "transaction")
      .maybeSingle();

    if (entryError || !entry) {
      return jsonResponse(req, {
        error: "This transaction is confirmed but has no ledger entry. " +
               "Refusing to void — investigate before correcting.",
        code: "missing_entry",
      }, 422);
    }

    const { data: existingReversal } = await admin
      .from("ledger_entries").select("id").eq("reverses_entry_id", entry.id).maybeSingle();

    if (existingReversal) {
      return jsonResponse(req, {
        error: "This entry has already been reversed",
        entry_id: existingReversal.id,
      }, 409);
    }

    // Negate the legs that were actually posted.
    const { data: postings, error: postingsError } = await admin
      .from("postings")
      .select("amount_minor, accounts(kind, name)")
      .eq("entry_id", entry.id);

    if (postingsError || !postings || postings.length < 2) {
      return jsonResponse(req, { error: "Could not read the original entry" }, 500);
    }

    // deno-lint-ignore no-explicit-any
    const legs = (postings as any[]).map((p) => {
      const account = Array.isArray(p.accounts) ? p.accounts[0] : p.accounts;
      const amount = -Number(p.amount_minor);
      return account.kind === "platform"
        ? { kind: "platform", platform: account.name, amount_minor: amount }
        : { kind: account.kind, amount_minor: amount };
    });

    const { data: reversalId, error: postError } = await admin.rpc("post_entry", {
      p_operator_id: operator.id,
      p_kind: "reversal",
      p_legs: legs,
      p_transaction_id: tx.id,
      p_memo: body.reason ? `Voided: ${body.reason}` : "Voided",
      p_idempotency_key: body.idempotency_key,
      p_created_by: user.id,
      p_reverses: entry.id,
    });

    if (postError) {
      console.error("Reversal failed:", postError.message);
      return jsonResponse(req, { error: "Could not post the reversal" }, 500);
    }

    const { error: updateError } = await admin
      .from("transactions")
      .update({ status: "voided" })
      .eq("id", tx.id).eq("operator_id", operator.id);

    if (updateError) {
      console.error("Reversal posted but status update failed:", updateError.message);
      return jsonResponse(req, {
        error: "Reversal posted but the transaction could not be marked voided. " +
               "Retry with the same idempotency_key.",
        entry_id: reversalId,
      }, 500);
    }

    await enqueueReceipt(admin, tx.image_url);

    return jsonResponse(req, {
      transaction_id: tx.id,
      status: "voided",
      reversed_entry_id: entry.id,
      entry_id: reversalId,
    });
  } catch (err) {
    console.error("Unhandled error in void-transaction:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}

/**
 * Queue the receipt for deletion rather than deleting it now.
 *
 * Retention is a window, not an event: a voided transaction may still be
 * disputed. `receipt_deletion_queue` already carries `delete_after`, and this
 * is the enqueue the old six-argument delete RPC never performed — which is why
 * storage held six objects against one transaction.
 *
 * Deliberately never throws. A receipt that fails to enqueue is a retention
 * problem to reconcile later; it must not fail the void, because the ledger
 * correction is the part that matters.
 */
// deno-lint-ignore no-explicit-any
async function enqueueReceipt(admin: any, imagePath: string | null): Promise<void> {
  if (!imagePath) return;
  try {
    await admin.from("receipt_deletion_queue").upsert({
      bucket: TRANSACTION_IMAGE_BUCKET,
      path: imagePath,
      delete_after: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "bucket,path" });
  } catch (err) {
    console.error("Could not enqueue receipt for deletion:", err);
  }
}
