"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import type { Session } from "@supabase/supabase-js";

export type Role = "owner" | "staff";

interface AppSession {
  session: Session | null;
  operatorId: string | null;
  /**
   * owner: everything. staff: record and view, nothing that changes the books
   * after the fact. Null while loading. This only decides what the app SHOWS;
   * the server enforces it.
   */
  role: Role | null;
  loading: boolean;
}

/**
 * Handles both auth and operator record checks.
 * - No session → redirects to /login
 * - Session but no shop (owns none, staff of none) → redirects to /onboarding
 * - Otherwise → returns session, operatorId and the login's role in that shop
 */
let remembered: { session: Session; operatorId: string; role: Role } | null = null;

export function useAuthGuard(opts: { ownerOnly?: boolean } = {}): AppSession {
  const ownerOnly = opts.ownerOnly === true;
  const router = useRouter();
  const known = remembered && (!ownerOnly || remembered.role === "owner") ? remembered : null;
  const [session, setSession] = useState<Session | null>(known?.session ?? null);
  const [operatorId, setOperatorId] = useState<string | null>(known?.operatorId ?? null);
  const [role, setRole] = useState<Role | null>(known?.role ?? null);
  const [loading, setLoading] = useState(known === null);

  useEffect(() => {
    async function init() {
      const {
        data: { session: s },
      } = await supabase.auth.getSession();

      if (!s) {
        remembered = null;
        router.replace("/login");
        return;
      }

      setSession(s);

      // A FAILED lookup is not "no operator". Offline, or on a transient
      // error, this used to send an operator who was already set up to
      // onboarding, which then refused them. Keep trying instead; the page
      // stays on its loading state until the lookup actually answers.
      // my_membership(), not a lookup of operators by user_id: staff record in
      // a shop they do not own, and that lookup only ever found the owner.
      let op: { id: string; role: Role } | null = null;
      for (let attempt = 0; ; attempt++) {
        const { data, error } = await supabase.rpc("my_membership");
        if (cancelled) return;
        if (!error) {
          const row = Array.isArray(data) ? data[0] : null;
          op = row ? { id: row.operator_id, role: row.role } : null;
          break;
        }
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
        if (cancelled) return;
      }

      if (!op) {
        router.replace("/onboarding");
        return;
      }

      // An owner-only screen opened by staff (a typed URL, an old link): send
      // them back rather than show a form the server will refuse.
      if (ownerOnly && op.role !== "owner") {
        router.replace("/settings");
        return;
      }

      remembered = { session: s, operatorId: op.id, role: op.role };
      setOperatorId(op.id);
      setRole(op.role);
      setLoading(false);
    }

    let cancelled = false;
    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT" || !s) {
        remembered = null;
        router.replace("/login");
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, ownerOnly]);

  return { session, operatorId, role, loading };
}
