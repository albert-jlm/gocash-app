import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import { resolveMembership, refuseUnlessOwner } from "./_shared/operator.ts";
import { LedgerError, balanced } from "../_core/postings.ts";
import { toMinor, toPesos, type Minor } from "../_core/money.ts";

const MAX_EARNINGS_MINOR = 10_000_000_000;

function asMinor(value: unknown): Minor {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n)) {
    throw new LedgerError(`not an exact centavo integer: ${String(value)}`);
  }
  return n;
}

export async function handleAdjustEarnings(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req, { error: "Missing authorization" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, db: { schema: "gocash" } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse(req, { error: "Unauthorized" }, 401);

    const membership = await resolveMembership(userClient);
    if (!membership) return jsonResponse(req, { error: "Operator record not found" }, 404);
    const refusal = refuseUnlessOwner(req, membership);
    if (refusal) return refusal;
    const operatorId = membership.operatorId;

    let body: { earnings_pesos?: unknown; idempotency_key?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse(req, { error: "Request body must be JSON" }, 400);
    }
    if (typeof body.earnings_pesos !== "number" || !Number.isFinite(body.earnings_pesos)) {
      return jsonResponse(req, { error: "earnings_pesos must be a number" }, 400);
    }
    if (typeof body.idempotency_key !== "string" || body.idempotency_key.length === 0 || body.idempotency_key.length > 255) {
      return jsonResponse(req, { error: "idempotency_key is required" }, 400);
    }
    const wantedMinor = toMinor(body.earnings_pesos);
    if (wantedMinor < 0) return jsonResponse(req, { error: "Earnings cannot be negative" }, 400);
    if (wantedMinor > MAX_EARNINGS_MINOR) {
      return jsonResponse(req, { error: `Earnings above ${toPesos(MAX_EARNINGS_MINOR)} pesos are not accepted` }, 400);
    }

    const [revenueRes, takenRes] = await Promise.all([
      userClient.from("account_balances").select("balance_minor").eq("operator_id", operatorId).eq("kind", "revenue"),
      userClient.from("transactions").select("amount").eq("operator_id", operatorId)
        .eq("status", "confirmed").eq("transaction_type", "Profit Remittance"),
    ]);
    if (revenueRes.error || takenRes.error) {
      console.error("adjust-earnings read failed:", revenueRes.error?.message ?? takenRes.error?.message);
      return jsonResponse(req, { error: "Failed to read current earnings" }, 500);
    }

    const earnedMinor = -(revenueRes.data ?? []).reduce((sum, r) => sum + asMinor(r.balance_minor), 0);
    const takenMinor = (takenRes.data ?? []).reduce((sum, t) => sum + toMinor(Number(t.amount)), 0);
    const currentMinor = earnedMinor - takenMinor;
    const differenceMinor = wantedMinor - currentMinor;

    if (differenceMinor === 0) {
      return jsonResponse(req, { posted: false, replayed: false, earnings: toPesos(currentMinor), difference: 0 });
    }

    const legs = balanced([
      { account: { kind: "revenue" }, amount: -differenceMinor },
      { account: { kind: "equity" }, amount: differenceMinor },
    ]);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" } },
    );
    const { data: priorEntry } = await adminClient.from("ledger_entries").select("id")
      .eq("operator_id", operatorId).eq("idempotency_key", body.idempotency_key).maybeSingle();

    const { data: entryId, error: postError } = await adminClient.rpc("post_entry", {
      p_operator_id: operatorId,
      p_kind: "reconciliation",
      p_legs: legs.map((p) => ({ kind: p.account.kind, amount_minor: p.amount })),
      p_transaction_id: null,
      p_memo: `Earnings set to ${toPesos(wantedMinor)} by the owner (was ${toPesos(currentMinor)})`,
      p_idempotency_key: body.idempotency_key,
      p_created_by: user.id,
      p_reverses: null,
    });
    if (postError || !entryId) {
      console.error("post_entry failed for adjust-earnings:", postError?.message);
      return jsonResponse(req, { error: "Failed to save the new earnings figure", detail: postError?.message }, 500);
    }

    return jsonResponse(req, {
      posted: !priorEntry,
      replayed: Boolean(priorEntry),
      entry_id: entryId,
      earnings: toPesos(wantedMinor),
      difference: toPesos(differenceMinor),
    });
  } catch (err) {
    if (err instanceof LedgerError) return jsonResponse(req, { error: err.message }, 400);
    console.error("adjust-earnings failed:", err instanceof Error ? err.message : err);
    return jsonResponse(req, { error: "Something went wrong" }, 500);
  }
}
