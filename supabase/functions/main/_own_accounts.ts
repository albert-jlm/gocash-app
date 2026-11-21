/**
 * own-accounts — the shop's own numbers and account numbers.
 *
 * The owner lists them once, each against the wallet it belongs to. The
 * receipt reader then knows when the other side of a receipt was the shop
 * itself, and records a transfer between wallets instead of a customer
 * transaction. Owner only: these are personal numbers.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import { resolveMembership, refuseUnlessOwner } from "./_shared/operator.ts";

interface RequestBody {
  action: "list" | "add" | "remove";
  account_id?: string;
  kind?: "mobile" | "account";
  value?: string;
  label?: string | null;
  identifier_id?: string;
}

export async function handleOwnAccounts(req: Request): Promise<Response> {
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

    const membership = await resolveMembership(userClient);
    if (!membership) return jsonResponse(req, { error: "Operator record not found" }, 404);

    const refusal = refuseUnlessOwner(req, membership);
    if (refusal) return refusal;

    const body: RequestBody = await req.json();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" } }
    );

    if (body.action === "list") {
      const [{ data: identifiers, error }, { data: wallets }] = await Promise.all([
        admin.from("operator_identifiers")
          .select("id, account_id, kind, value, label, created_at")
          .eq("operator_id", membership.operatorId).order("created_at"),
        admin.from("accounts").select("id, name")
          .eq("operator_id", membership.operatorId).eq("kind", "platform").eq("is_active", true)
          .order("name"),
      ]);
      if (error) {
        console.error("list identifiers failed:", error.code, error.message);
        return jsonResponse(req, { error: "Could not load your numbers" }, 500);
      }
      return jsonResponse(req, { identifiers: identifiers ?? [], wallets: wallets ?? [] });
    }

    if (body.action === "add") {
      if (typeof body.account_id !== "string" || body.account_id === "") {
        return jsonResponse(req, { error: "Choose which wallet this belongs to" }, 400);
      }
      if (body.kind !== "mobile" && body.kind !== "account") {
        return jsonResponse(req, { error: "Choose mobile number or account number" }, 400);
      }
      if (typeof body.value !== "string" || body.value.trim() === "") {
        return jsonResponse(req, { error: "Enter the number" }, 400);
      }

      const { data: id, error } = await admin.rpc("add_identifier", {
        p_operator_id: membership.operatorId,
        p_account_id: body.account_id,
        p_kind: body.kind,
        p_value: body.value,
        p_label: typeof body.label === "string" ? body.label.slice(0, 60) : null,
      });

      if (error) {
        if (error.code === "GC030") {
          return jsonResponse(req, {
            error: body.kind === "mobile"
              ? "That isn't a mobile number. Use 11 digits starting with 09."
              : "That isn't an account number. Use the digits only, at least 4.",
            code: "invalid_value",
          }, 400);
        }
        if (error.code === "GC031") {
          return jsonResponse(req, { error: "That wallet isn't one of yours", code: "unknown_wallet" }, 422);
        }
        if (error.code === "GC032") {
          return jsonResponse(req, { error: "That number is already on your list", code: "exists" }, 409);
        }
        console.error("add_identifier failed:", error.code, error.message);
        return jsonResponse(req, { error: "Could not add that number" }, 500);
      }

      const { data: row } = await admin.from("operator_identifiers")
        .select("id, account_id, kind, value, label, created_at").eq("id", id).single();
      return jsonResponse(req, { identifier: row });
    }

    if (body.action === "remove") {
      if (typeof body.identifier_id !== "string" || body.identifier_id === "") {
        return jsonResponse(req, { error: "identifier_id is required" }, 400);
      }
      const { data, error } = await admin.from("operator_identifiers")
        .delete()
        .eq("id", body.identifier_id).eq("operator_id", membership.operatorId)
        .select("id");
      if (error) {
        console.error("remove identifier failed:", error.code, error.message);
        return jsonResponse(req, { error: "Could not remove that number" }, 500);
      }
      if (!data || data.length === 0) return jsonResponse(req, { error: "Not found" }, 404);
      return jsonResponse(req, { removed: body.identifier_id });
    }

    return jsonResponse(req, { error: 'action must be "list", "add" or "remove"' }, 400);
  } catch (err) {
    console.error("Unhandled error in own-accounts:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}
