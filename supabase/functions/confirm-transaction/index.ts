/**
 * confirm-transaction — Phase 2 Edge Function
 *
 * Confirms a draft transaction (status: awaiting_confirmation) after the
 * operator has reviewed and optionally edited the AI-extracted fields.
 *
 * Steps:
 *   1. Verify the operator owns the transaction
 *   2. Apply any edits the operator made on the review screen
 *   3. Re-compute profit if amount or type changed
 *   4. Update wallet balances using the delta multiplier rules
 *   5. Mark the transaction as confirmed
 *
 * Called by: Review & Save screen "Save Transaction" button
 * Auth required: Yes — Supabase JWT in Authorization header
 *
 * IMPORTANT: Wallet balance changes ONLY happen here (Phase 2).
 * Never update wallet balances anywhere else in the app.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import {
  calculateProfit,
  computeWalletDeltas,
  type TransactionRule,
} from "../_shared/transaction-processing.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestBody {
  transaction_id: string;
  /** Optional operator edits — only include fields that were changed */
  edits?: {
    platform?: string;
    transaction_type?: string;
    amount?: number;
    account_number?: string | null;
    reference_number?: string | null;
    transaction_date?: string | null;
    net_profit?: number; // override profit if operator wants custom value
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse(req,{ error: "Method not allowed" }, 405);
  }

  try {
    // ----- 1. Auth — verify user identity -----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req,{ error: "Missing authorization" }, 401);

    // User-scoped client — used only for ownership checks
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
        db: { schema: "gocash" },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) return jsonResponse(req,{ error: "Unauthorized" }, 401);

    // ----- 2. Resolve operator -----
    const { data: operator, error: opError } = await userClient
      .from("operators")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (opError || !operator) {
      return jsonResponse(req,{ error: "Operator record not found" }, 404);
    }

    // ----- 3. Parse request -----
    const body: RequestBody = await req.json();
    if (!body.transaction_id) {
      return jsonResponse(req,{ error: "transaction_id is required" }, 400);
    }

    // ----- 4. Fetch transaction and verify ownership -----
    const { data: tx, error: txFetchError } = await userClient
      .from("transactions")
      .select("*")
      .eq("id", body.transaction_id)
      .eq("operator_id", operator.id) // ownership check via RLS + explicit filter
      .single();

    if (txFetchError || !tx) {
      return jsonResponse(req,{ error: "Transaction not found or access denied" }, 404);
    }

    if (tx.status === "confirmed") {
      return jsonResponse(req,{ error: "Transaction is already confirmed" }, 409);
    }

    if (tx.status === "failed") {
      return jsonResponse(req,{ error: "Cannot confirm a failed transaction" }, 409);
    }

    // ----- 5. Validate edits -----
    const edits = body.edits ?? {};

    if (edits.amount !== undefined) {
      if (
        typeof edits.amount !== "number" ||
        !isFinite(edits.amount) ||
        edits.amount < 0 ||
        edits.amount > 1_000_000
      ) {
        return jsonResponse(req, { error: "Invalid amount: must be a number between 0 and 1,000,000" }, 400);
      }
    }

    if (edits.net_profit !== undefined) {
      if (
        typeof edits.net_profit !== "number" ||
        !isFinite(edits.net_profit) ||
        edits.net_profit < 0 ||
        edits.net_profit > 100_000
      ) {
        return jsonResponse(req, { error: "Invalid net_profit: must be a number between 0 and 100,000" }, 400);
      }
    }

    const VALID_PLATFORMS = ["GCash", "MariBank", "Maya", "Unknown"];
    if (edits.platform !== undefined && !VALID_PLATFORMS.includes(edits.platform)) {
      return jsonResponse(req, { error: `Invalid platform. Allowed: ${VALID_PLATFORMS.join(", ")}` }, 400);
    }

    const VALID_TYPES = ["Cash In", "Cash Out", "Telco Load", "Bills Payment", "Bank Transfer", "Profit Remittance"];
    if (edits.transaction_type !== undefined && !VALID_TYPES.includes(edits.transaction_type)) {
      return jsonResponse(req, { error: `Invalid transaction_type. Allowed: ${VALID_TYPES.join(", ")}` }, 400);
    }
    const wasEdited = Object.keys(edits).length > 0;

    const platform = edits.platform ?? tx.platform;
    const txType = edits.transaction_type ?? tx.transaction_type;
    const amount = edits.amount ?? tx.amount;

    // Build edit history entry if anything changed
    const editHistoryEntry = wasEdited
      ? {
          edited_at: new Date().toISOString(),
          edited_by: user.id,
          changes: edits,
          previous: {
            platform: tx.platform,
            transaction_type: tx.transaction_type,
            amount: tx.amount,
            account_number: tx.account_number,
            reference_number: tx.reference_number,
            transaction_date: tx.transaction_date,
            net_profit: tx.net_profit,
          },
        }
      : null;

    // ----- 6. Fetch rules and (re-)compute profit -----
    // Service role client — needed for wallet balance updates (bypasses RLS)
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" } }
    );

    const { data: rules } = await adminClient
      .from("transaction_rules")
      .select("*")
      .eq("operator_id", operator.id)
      .eq("is_active", true);

    // Operator can override profit; otherwise recalculate if amount/type changed
    const netProfit =
      edits.net_profit !== undefined
        ? edits.net_profit
        : wasEdited
        ? calculateProfit(txType, platform, amount, (rules ?? []) as TransactionRule[])
        : tx.net_profit;

    // ----- 7. Compute wallet deltas -----
    const deltas = computeWalletDeltas(
      txType,
      platform,
      amount,
      netProfit,
      (rules ?? []) as TransactionRule[]
    );

    if (!deltas) {
      return jsonResponse(req,
        { error: `No matching transaction rule found for type "${txType}" on platform "${platform}"` },
        422
      );
    }

    // ----- 8. Atomically: update both wallets + confirm the transaction -----
    // Single Postgres function — if any step fails the whole thing rolls back.
    const finalEditHistory = wasEdited
      ? [...(Array.isArray(tx.edit_history) ? tx.edit_history : []), editHistoryEntry]
      : tx.edit_history;

    const { error: atomicError } = await adminClient.rpc(
      "confirm_transaction_atomic",
      {
        p_transaction_id:   tx.id,
        p_operator_id:      operator.id,
        p_user_id:          user.id,
        p_platform_wallet:  deltas.platform_wallet_name,
        p_platform_delta:   deltas.platform_delta,
        p_cash_delta:       deltas.cash_delta,
        p_status:           "confirmed",
        p_net_profit:       netProfit,
        p_platform:         platform,
        p_transaction_type: txType,
        p_amount:           amount,
        p_account_number:   wasEdited ? (edits.account_number ?? tx.account_number) : tx.account_number,
        p_reference_number: wasEdited ? (edits.reference_number ?? tx.reference_number) : tx.reference_number,
        p_transaction_date: wasEdited ? (edits.transaction_date ?? tx.transaction_date) : tx.transaction_date,
        p_was_edited:       wasEdited,
        p_edit_history:     finalEditHistory,
      }
    );

    if (atomicError) {
      console.error("Atomic confirm failed:", atomicError.message);
      return jsonResponse(req, { error: "Failed to confirm transaction" }, 500);
    }

    // ----- 9. Return confirmed transaction -----
    return jsonResponse(req, {
      transaction_id: tx.id,
      status: "confirmed",
      platform,
      transaction_type: txType,
      amount,
      net_profit: netProfit,
      account_number: wasEdited ? (edits.account_number ?? tx.account_number) : tx.account_number,
      reference_number: wasEdited ? (edits.reference_number ?? tx.reference_number) : tx.reference_number,
      wallet_deltas: {
        [deltas.platform_wallet_name]: deltas.platform_delta,
        Cash: deltas.cash_delta,
      },
    });
  } catch (err) {
    console.error("Unhandled error in confirm-transaction:", err);
    return jsonResponse(req,{ error: "Internal server error" }, 500);
  }
});
