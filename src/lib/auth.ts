import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

export type AuthDestination = "/" | "/login" | "/onboarding";

export async function getOperatorIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("operators")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  return data?.id ?? null;
}

export async function resolveAuthDestination(session: Session | null): Promise<{
  destination: AuthDestination;
  operatorId: string | null;
}> {
  if (!session) {
    return { destination: "/login", operatorId: null };
  }

  const operatorId = await getOperatorIdForUser(session.user.id);

  return {
    destination: operatorId ? "/" : "/onboarding",
    operatorId,
  };
}
