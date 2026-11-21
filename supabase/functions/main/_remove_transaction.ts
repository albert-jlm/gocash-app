import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import { resolveMembership, refuseUnlessOwner } from "./_shared/operator.ts";
import { TRANSACTION_IMAGE_BUCKET } from "./_shared/storage.ts";

export async function handleRemoveTransaction(req: Request): Promise<Response> {
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

    let body: { transaction_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse(req, { error: "Request body must be JSON" }, 400);
    }
    if (typeof body.transaction_id !== "string" || body.transaction_id === "") {
      return jsonResponse(req, { error: "transaction_id is required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" }, auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data, error } = await admin.rpc("delete_voided_transaction", {
      p_operator_id: membership.operatorId,
      p_transaction_id: body.transaction_id,
    });
    if (error) {
      if (error.code === "GC040") {
        return jsonResponse(req, { error: "Void it first. Only a voided transaction can be deleted." }, 409);
      }
      if (error.code === "P0002") return jsonResponse(req, { error: "Transaction not found" }, 404);
      console.error("delete_voided_transaction failed:", error.code, error.message);
      return jsonResponse(req, { error: "Could not delete the transaction" }, 500);
    }

    const imagePath = (data as { image_url?: string | null } | null)?.image_url ?? null;
    if (imagePath) {
      try {
        await admin.from("receipt_deletion_queue").upsert({
          bucket: TRANSACTION_IMAGE_BUCKET,
          path: imagePath,
          delete_after: new Date().toISOString(),
        }, { onConflict: "bucket,path" });
      } catch (err) {
        console.error("Could not enqueue receipt for deletion:", err);
      }
    }

    return jsonResponse(req, { deleted: body.transaction_id, outcome: (data as { outcome?: string } | null)?.outcome ?? "removed" });
  } catch (err) {
    console.error("Unhandled error in remove-transaction:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}
