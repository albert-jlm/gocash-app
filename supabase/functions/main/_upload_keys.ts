/**
 * upload-keys — keys that let a phone's share sheet send a screenshot in.
 *
 * A key can do one thing: create a DRAFT from an image (see share-upload).
 * It cannot read anything, confirm anything or move a balance, which is what
 * makes it safe to leave inside an Apple Shortcut indefinitely.
 *
 * The key is shown once, when it is made. Only its SHA-256 is stored.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import { resolveMembership } from "./_shared/operator.ts";

interface RequestBody {
  action: "list" | "create" | "revoke";
  label?: string;
  key_id?: string;
}

export const UPLOAD_KEY_PREFIX = "gck_";
const MAX_ACTIVE_KEYS_PER_PERSON = 10;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return UPLOAD_KEY_PREFIX + b64;
}

export async function handleUploadKeys(req: Request): Promise<Response> {
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

    const body: RequestBody = await req.json();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" } }
    );

    // Each person manages their own keys. Staff and owner alike: it is their
    // phone. (Removing a staff member revokes theirs.)
    if (body.action === "list") {
      const { data, error } = await admin
        .from("upload_keys")
        .select("id, label, key_prefix, created_at, last_used_at")
        .eq("operator_id", membership.operatorId)
        .eq("user_id", user.id)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) {
        console.error("list upload keys failed:", error.code, error.message);
        return jsonResponse(req, { error: "Could not load your keys" }, 500);
      }
      return jsonResponse(req, { keys: data ?? [] });
    }

    if (body.action === "create") {
      const label = (body.label ?? "").trim().slice(0, 60) || "My phone";

      const { count } = await admin
        .from("upload_keys")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("revoked_at", null);
      if ((count ?? 0) >= MAX_ACTIVE_KEYS_PER_PERSON) {
        return jsonResponse(req, {
          error: "You have too many keys. Remove one you no longer use first.",
        }, 409);
      }

      const key = newKey();
      const { data, error } = await admin
        .from("upload_keys")
        .insert({
          operator_id: membership.operatorId,
          user_id: user.id,
          label,
          key_hash: await sha256Hex(key),
          key_prefix: key.slice(0, 10),
        })
        .select("id, label, key_prefix, created_at, last_used_at")
        .single();

      if (error || !data) {
        console.error("create upload key failed:", error?.code, error?.message);
        return jsonResponse(req, { error: "Could not create the key" }, 500);
      }

      // The only time the key itself is returned.
      return jsonResponse(req, { key, record: data });
    }

    if (body.action === "revoke") {
      if (typeof body.key_id !== "string" || body.key_id === "") {
        return jsonResponse(req, { error: "key_id is required" }, 400);
      }
      const { data, error } = await admin
        .from("upload_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", body.key_id)
        .eq("operator_id", membership.operatorId)
        .eq("user_id", user.id)
        .is("revoked_at", null)
        .select("id");
      if (error) {
        console.error("revoke upload key failed:", error.code, error.message);
        return jsonResponse(req, { error: "Could not remove the key" }, 500);
      }
      if (!data || data.length === 0) return jsonResponse(req, { error: "Key not found" }, 404);
      return jsonResponse(req, { revoked: body.key_id });
    }

    return jsonResponse(req, { error: 'action must be "list", "create" or "revoke"' }, 400);
  } catch (err) {
    console.error("Unhandled error in upload-keys:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}
