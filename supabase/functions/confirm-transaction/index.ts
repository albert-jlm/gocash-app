import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import {
  calculateProfit,
  computeWalletDeltas,
  type TransactionRule,
} from "../_shared/transaction-processing.ts";

interface RequestBody {
  transaction_id: string;
edits?: {
    platform?: string;
    transaction_type?: string;
    amount?: number;
    account_number?: string | null;
    reference_number?: string | null;
    transaction_date?: string | null;
    net_profit?: number;
  };
}

function isMissingOperatorPlatformsError(message?: string | null): boolean {
  return Boolean(
    message && (
      message.includes("operator_platforms")
      || message.includes("schema cache")
      || message.includes("Could not find the table")
    )
  );
}

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse(req,{ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req,{ error: "Missing authorization" }, 401);

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

    const { data: operator, error: opError } = await userClient
      .from("operators")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (opError || !operator) {
      return jsonResponse(req,{ error: "Operator record not found" }, 404);
    }

    const body: RequestBody = await req.json();
    if (!body.transaction_id) {
      return jsonResponse(req,{ error: "transaction_id is required" }, 400);
    }

    const { data: tx, error: txFetchError } = await userClient
      .from("transactions")
      .select("*")
      .eq("id", body.transaction_id)
      .eq("operator_id", operator.id)
      .single();

    if (txFetchError || !tx) {
      return jsonResponse(req,{ error: "Transaction not found or access denied" }, 404);
    }

    if (!["confirmed", "edited"].includes(tx.status)) {
      return jsonResponse(req,{ error: `Cannot edit transaction with status "${tx.status}"` }, 409);
    }

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

    const VALID_TYPES = ["Cash In", "Cash Out", "Telco Load", "Bills Payment", "Bank Transfer", "Profit Remittance"];
    if (edits.transaction_type !== undefined && !VALID_TYPES.includes(edits.transaction_type)) {
      return jsonResponse(req, { error: `Invalid transaction_type. Allowed: ${VALID_TYPES.join(", ")}` }, 400);
    }
    const wasEdited = Object.keys(edits).length > 0;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" } }
    );

    let validPlatformNames: string[] = [];

    const { data: activePlatforms, error: activePlatformsError } = await userClient
      .from("operator_platforms")
      .select("name")
      .eq("operator_id", operator.id)
      .eq("is_active", true);

    if (activePlatformsError && !isMissingOperatorPlatformsError(activePlatformsError.message)) {
      return jsonResponse(req, { error: "Failed to load operator platforms" }, 500);
    }

    if (activePlatformsError) {
      const { data: platformWallets, error: walletsError } = await userClient
        .from("wallets")
        .select("wallet_name")
        .eq("operator_id", operator.id)
        .eq("wallet_type", "platform")
        .eq("is_active", true);

      if (walletsError) {
        return jsonResponse(req, { error: "Failed to load operator platforms" }, 500);
      }

      validPlatformNames = (platformWallets ?? []).map((row) => row.wallet_name);
    } else {
      validPlatformNames = (activePlatforms ?? []).map((row) => row.name);
    }

    const validPlatforms = new Set(validPlatformNames);
    validPlatforms.add("Unknown");

    const platform = edits.platform ?? tx.platform;
    if (!validPlatforms.has(platform)) {
      return jsonResponse(req, { error: `Invalid platform for this operator: ${platform}` }, 400);
    }

    if (platform === "Unknown" && !validPlatformNames.includes("GCash")) {
      return jsonResponse(
        req,
        { error: "Unknown transactions require an active GCash wallet. Re-add GCash first." },
        400
      );
    }

    const txType = edits.transaction_type ?? tx.transaction_type;
    const amount = edits.amount ?? tx.amount;

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

    const { data: rules } = await adminClient
      .from("transaction_rules")
      .select("*")
      .eq("operator_id", operator.id)
      .eq("is_active", true);

    const netProfit =
      edits.net_profit !== undefined
        ? edits.net_profit
        : wasEdited
        ? calculateProfit(txType, platform, amount, (rules ?? []) as TransactionRule[])
        : tx.net_profit;

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

    const currentDeltas = computeWalletDeltas(
      tx.transaction_type,
      tx.platform,
      tx.amount,
      tx.net_profit,
      (rules ?? []) as TransactionRule[]
    );

    if (!currentDeltas) {
      return jsonResponse(
        req,
        {
          error:
            "Cannot edit this transaction because its current platform/type no longer matches an active rule",
        },
        422
      );
    }

    const finalEditHistory = wasEdited
      ? [...(Array.isArray(tx.edit_history) ? tx.edit_history : []), editHistoryEntry]
      : tx.edit_history;
    const nextStatus = "edited";

    const { error: atomicError } = await adminClient.rpc(
      "confirm_transaction_atomic",
      {
        p_transaction_id:   tx.id,
        p_operator_id:      operator.id,
        p_user_id:          user.id,
        p_previous_platform_wallet: currentDeltas.platform_wallet_name,
        p_previous_platform_delta: -currentDeltas.platform_delta,
        p_next_platform_wallet:  deltas.platform_wallet_name,
        p_next_platform_delta:   deltas.platform_delta,
        p_cash_delta:       deltas.cash_delta - currentDeltas.cash_delta,
        p_status:           nextStatus,
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
      console.error("Atomic edit failed:", atomicError.message);
      return jsonResponse(req, { error: "Failed to update transaction" }, 500);
    }

    return jsonResponse(req, {
      transaction_id: tx.id,
      status: nextStatus,
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
