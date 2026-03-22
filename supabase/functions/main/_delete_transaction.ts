import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import {
  computeWalletDeltas,
  type TransactionRule,
} from "./_shared/transaction-processing.ts";

interface RequestBody {
  transaction_id: string;
}

export async function handleDeleteTransaction(req: Request): Promise<Response> {
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
      {
        global: { headers: { Authorization: authHeader } },
        db: { schema: "gocash" },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) return jsonResponse(req, { error: "Unauthorized" }, 401);

    const { data: operator, error: opError } = await userClient
      .from("operators")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (opError || !operator) {
      return jsonResponse(req, { error: "Operator record not found" }, 404);
    }

    const body: RequestBody = await req.json();
    if (!body.transaction_id) {
      return jsonResponse(req, { error: "transaction_id is required" }, 400);
    }

    const { data: tx, error: txFetchError } = await userClient
      .from("transactions")
      .select("*")
      .eq("id", body.transaction_id)
      .eq("operator_id", operator.id)
      .single();

    if (txFetchError || !tx) {
      return jsonResponse(req, { error: "Transaction not found or access denied" }, 404);
    }

    if (!["confirmed", "edited"].includes(tx.status)) {
      return jsonResponse(req, { error: `Cannot delete transaction with status "${tx.status}"` }, 409);
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" } }
    );

    // Fetch rules to compute current wallet deltas for reversal
    const { data: rules } = await adminClient
      .from("transaction_rules")
      .select("*")
      .eq("operator_id", operator.id)
      .eq("is_active", true);

    const currentDeltas = computeWalletDeltas(
      tx.transaction_type,
      tx.platform,
      tx.amount,
      tx.net_profit,
      (rules ?? []) as TransactionRule[]
    );

    // Negate the deltas to reverse the wallet effects
    const { error: deleteError } = await adminClient.rpc(
      "delete_transaction_atomic",
      {
        p_transaction_id:  tx.id,
        p_operator_id:     operator.id,
        p_user_id:         user.id,
        p_platform_wallet: currentDeltas?.platform_wallet_name ?? null,
        p_platform_delta:  currentDeltas ? -currentDeltas.platform_delta : 0,
        p_cash_delta:      currentDeltas ? -currentDeltas.cash_delta : 0,
      }
    );

    if (deleteError) {
      console.error("Atomic delete failed:", deleteError.message);
      return jsonResponse(req, { error: "Failed to delete transaction" }, 500);
    }

    return jsonResponse(req, {
      deleted: true,
      transaction_id: tx.id,
    });
  } catch (err) {
    console.error("Unhandled error in delete-transaction:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}
