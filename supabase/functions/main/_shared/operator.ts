/**
 * Whose books a login records in, and in what role.
 *
 * Every handler used to look up `operators` by `user_id`. That only finds the
 * owner. Staff are members of an operator they do not own, so the question is
 * asked of gocash.my_membership(), which answers for auth.uid() and nobody
 * else. Nothing about the operator is ever taken from the request body.
 */

import { jsonResponse } from "./cors.ts";

export type Role = "owner" | "admin" | "staff";

export interface Membership {
  operatorId: string;
  role: Role;
}

/** `userClient` must carry the caller's JWT. Null means "not set up". */
// deno-lint-ignore no-explicit-any
export async function resolveMembership(userClient: any): Promise<Membership | null> {
  const { data, error } = await userClient.rpc("my_membership");
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || !row.operator_id) return null;
  return {
    operatorId: row.operator_id,
    role: row.role === "owner" ? "owner" : row.role === "admin" ? "admin" : "staff",
  };
}

/**
 * A 403 for staff, null for the owner. For the things that change what the
 * books say after the fact: voiding, reconciling a count, fees, wallets,
 * and who has access.
 */
export function refuseUnlessOwner(req: Request, membership: Membership): Response | null {
  if (membership.role === "owner" || membership.role === "admin") return null;
  return jsonResponse(req, {
    error: "Only the owner or an admin can do this. Ask them to do it from their account.",
    code: "owner_only",
  }, 403);
}

export function refuseUnlessFounder(req: Request, membership: Membership): Response | null {
  if (membership.role === "owner") return null;
  return jsonResponse(req, {
    error: "Only the owner can do this.",
    code: "founder_only",
  }, 403);
}
