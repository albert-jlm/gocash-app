/**
 * manage-platform — add a wallet, or retire one.
 *
 * Settings → Platforms used to write gocash.accounts from the browser. The
 * browser role has only SELECT there, so both actions failed. They are small,
 * but they change the chart of accounts, so they go through the server like
 * everything else that does.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import { resolveMembership, refuseUnlessOwner } from "./_shared/operator.ts";

interface RequestBody {
  action: "add" | "retire";
  /** add */
  name?: string;
  /** retire */
  account_id?: string;
}

export async function handleManagePlatform(req: Request): Promise<Response> {
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

    // The operator comes from the verified JWT, never from the body.
    const membership = await resolveMembership(userClient);
    if (!membership) {
      return jsonResponse(req, { error: "Operator record not found" }, 404);
    }
    const operator = { id: membership.operatorId };
    const refusal = refuseUnlessOwner(req, membership);
    if (refusal) return refusal;

    const body: RequestBody = await req.json();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" } }
    );

    if (body.action === "add") {
      if (typeof body.name !== "string" || body.name.trim() === "") {
        return jsonResponse(req, { error: "Enter a name for the wallet" }, 400);
      }

      const { data: accountId, error } = await admin.rpc("add_platform", {
        p_operator_id: operator.id,
        p_name: body.name,
      });

      if (error) {
        if (error.code === "GC010") {
          return jsonResponse(req, {
            error: "That name can't be used. Pick another, up to 40 characters.",
            code: "invalid_name",
          }, 400);
        }
        if (error.code === "GC011") {
          return jsonResponse(req, {
            error: "You already have a wallet with this name", code: "exists",
          }, 409);
        }
        console.error("add_platform failed:", error.code, error.message);
        return jsonResponse(req, { error: "Could not add the wallet" }, 500);
      }

      const { data: account } = await admin
        .from("accounts").select("id, name, kind, is_active")
        .eq("id", accountId).single();

      return jsonResponse(req, { account });
    }

    if (body.action === "retire") {
      if (typeof body.account_id !== "string" || body.account_id === "") {
        return jsonResponse(req, { error: "account_id is required" }, 400);
      }

      const { error } = await admin.rpc("retire_platform", {
        p_operator_id: operator.id,
        p_account_id: body.account_id,
      });

      if (error) {
        if (error.code === "GC012") {
          return jsonResponse(req, {
            error: "This wallet still has a balance. Bring it to zero first " +
                   "(Settings → Wallets), then remove it.",
            code: "has_balance",
          }, 409);
        }
        if (error.code === "P0002") {
          return jsonResponse(req, { error: "Wallet not found" }, 404);
        }
        console.error("retire_platform failed:", error.code, error.message);
        return jsonResponse(req, { error: "Could not remove the wallet" }, 500);
      }

      return jsonResponse(req, { account_id: body.account_id, is_active: false });
    }

    return jsonResponse(req, { error: 'action must be "add" or "retire"' }, 400);
  } catch (err) {
    console.error("Unhandled error in manage-platform:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}
