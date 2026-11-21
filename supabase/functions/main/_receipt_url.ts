import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import { resolveMembership } from "./_shared/operator.ts";
import { TRANSACTION_IMAGE_BUCKET } from "./_shared/storage.ts";

export async function handleReceiptUrl(req: Request): Promise<Response> {
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

    let body: { transaction_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse(req, { error: "Request body must be JSON" }, 400);
    }
    if (typeof body.transaction_id !== "string" || body.transaction_id === "") {
      return jsonResponse(req, { error: "transaction_id is required" }, 400);
    }

    const { data: tx } = await userClient
      .from("transactions")
      .select("image_url")
      .eq("id", body.transaction_id)
      .eq("operator_id", membership.operatorId)
      .maybeSingle();
    if (!tx) return jsonResponse(req, { error: "Transaction not found" }, 404);
    if (!tx.image_url) return jsonResponse(req, { path: null });
    if (!String(tx.image_url).startsWith(`${membership.operatorId}/`)) {
      return jsonResponse(req, { path: null });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await admin.storage
      .from(TRANSACTION_IMAGE_BUCKET)
      .createSignedUrl(tx.image_url, 600);
    if (error || !data?.signedUrl) {
      console.error("createSignedUrl failed:", error?.message);
      return jsonResponse(req, { path: null });
    }
    const marker = "/storage/v1";
    const at = data.signedUrl.indexOf(marker);
    return jsonResponse(req, { path: at >= 0 ? data.signedUrl.slice(at) : null });
  } catch (err) {
    console.error("Unhandled error in receipt-url:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}
