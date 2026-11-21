/**
 * manage-staff — the owner gives other logins access to the shop's books.
 *
 * Signups are closed, so adding staff is also what creates their login: the
 * person then signs in with their own email and a code, and records into the
 * owner's books with the staff role (see 20260926000001 for what staff can
 * and cannot do).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import { resolveMembership, refuseUnlessOwner } from "./_shared/operator.ts";

interface RequestBody {
  action: "list" | "add" | "remove" | "role";
  email?: string;
  member_id?: string;
  role?: "staff" | "owner";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleManageStaff(req: Request): Promise<Response> {
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
      { db: { schema: "gocash" }, auth: { persistSession: false, autoRefreshToken: false } }
    );

    if (body.action === "list") {
      const { data, error } = await admin
        .from("operator_members")
        .select("id, email, role, created_at")
        .eq("operator_id", membership.operatorId)
        .order("created_at");
      if (error) {
        console.error("list staff failed:", error.code, error.message);
        return jsonResponse(req, { error: "Could not load staff" }, 500);
      }
      const { data: shop } = await admin
        .from("operators").select("email").eq("id", membership.operatorId).maybeSingle();
      return jsonResponse(req, {
        owner_email: shop?.email ?? null,
        your_email: user.email ?? null,
        staff: data ?? [],
      });
    }

    if (body.action === "add") {
      const email = (body.email ?? "").trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 200) {
        return jsonResponse(req, { error: "Enter a valid email address" }, 400);
      }
      if (email === (user.email ?? "").toLowerCase()) {
        return jsonResponse(req, { error: "That's your own email" }, 400);
      }

      // Make sure a login exists. "Already registered" is fine: add_staff
      // decides whether that existing login may be attached.
      const { error: createError } = await admin.auth.admin.createUser({
        email, email_confirm: true,
      });
      const alreadyExists = createError
        && /already|exists|registered/i.test(createError.message ?? "");
      if (createError && !alreadyExists) {
        console.error("create staff login failed:", createError.message);
        return jsonResponse(req, { error: "Could not create a login for that email" }, 500);
      }

      const { data: memberId, error } = await admin.rpc("add_staff_by_email", {
        p_operator_id: membership.operatorId,
        p_email: email,
        p_created_by: user.id,
      });

      if (error) {
        if (error.code === "GC020") {
          return jsonResponse(req, {
            error: "That email already has its own GoCash books, so it can't be added as staff.",
            code: "has_own_books",
          }, 409);
        }
        if (error.code === "GC021") {
          return jsonResponse(req, {
            error: "That email already has staff access.", code: "already_staff",
          }, 409);
        }
        console.error("add_staff_by_email failed:", error.code, error.message);
        return jsonResponse(req, { error: "Could not add that person" }, 500);
      }

      const role = body.role === "owner" ? "owner" : "staff";
      if (role === "owner") {
        const { error: roleError } = await admin.rpc("set_member_role", {
          p_operator_id: membership.operatorId, p_member_id: memberId, p_role: "owner",
        });
        if (roleError) {
          console.error("set_member_role failed:", roleError.code, roleError.message);
          return jsonResponse(req, { error: "Added as staff, but could not make them an owner" }, 500);
        }
      }

      return jsonResponse(req, {
        member: { id: memberId, email, role },
        note: "They can now sign in with this email. A code is sent to it each time.",
      });
    }

    if (body.action === "role") {
      if (typeof body.member_id !== "string" || body.member_id === "") {
        return jsonResponse(req, { error: "member_id is required" }, 400);
      }
      if (body.role !== "staff" && body.role !== "owner") {
        return jsonResponse(req, { error: 'role must be "staff" or "owner"' }, 400);
      }
      const { data: target } = await admin
        .from("operator_members").select("user_id")
        .eq("id", body.member_id).eq("operator_id", membership.operatorId).maybeSingle();
      if (!target) return jsonResponse(req, { error: "Person not found" }, 404);
      if (target.user_id === user.id) {
        return jsonResponse(req, { error: "You can't change your own role" }, 400);
      }
      const { error } = await admin.rpc("set_member_role", {
        p_operator_id: membership.operatorId, p_member_id: body.member_id, p_role: body.role,
      });
      if (error) {
        console.error("set_member_role failed:", error.code, error.message);
        return jsonResponse(req, { error: "Could not change that person's role" }, 500);
      }
      return jsonResponse(req, { member_id: body.member_id, role: body.role });
    }

    if (body.action === "remove") {
      const { data: target } = await admin
        .from("operator_members").select("user_id")
        .eq("id", body.member_id ?? "").eq("operator_id", membership.operatorId).maybeSingle();
      if (target && target.user_id === user.id) {
        return jsonResponse(req, { error: "You can't remove yourself" }, 400);
      }
      if (typeof body.member_id !== "string" || body.member_id === "") {
        return jsonResponse(req, { error: "member_id is required" }, 400);
      }

      const { data: removedUserId, error } = await admin.rpc("remove_staff", {
        p_operator_id: membership.operatorId,
        p_member_id: body.member_id,
      });

      if (error) {
        console.error("remove_staff failed:", error.code, error.message);
        return jsonResponse(req, { error: "Could not remove that person" }, 500);
      }
      if (!removedUserId) return jsonResponse(req, { error: "Staff member not found" }, 404);

      // Delete the login too. Left behind, it would have no shop, and the app
      // would offer it onboarding: a way to start separate books.
      const { error: deleteError } = await admin.auth.admin.deleteUser(removedUserId as string);
      if (deleteError) {
        console.error("staff access removed but login delete failed:", deleteError.message);
      }

      return jsonResponse(req, { removed: body.member_id });
    }

    return jsonResponse(req, { error: 'action must be "list", "add", "role" or "remove"' }, 400);
  } catch (err) {
    console.error("Unhandled error in manage-staff:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}
