"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import type { Session } from "@supabase/supabase-js";

interface AppSession {
  session: Session | null;
  operatorId: string | null;
  loading: boolean;
}

/**
 * Handles both auth and operator record checks.
 * - No session → redirects to /login
 * - Session but no operator record → redirects to /onboarding
 * - Both present → returns session + operatorId
 */
export function useAuthGuard(): AppSession {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      const {
        data: { session: s },
      } = await supabase.auth.getSession();

      if (!s) {
        router.replace("/login");
        return;
      }

      setSession(s);

      // A FAILED lookup is not "no operator". Offline, or on a transient
      // error, this used to send an operator who was already set up to
      // onboarding, which then refused them. Keep trying instead; the page
      // stays on its loading state until the lookup actually answers.
      let op: { id: string } | null = null;
      for (let attempt = 0; ; attempt++) {
        const { data, error } = await supabase
          .from("operators")
          .select("id")
          .eq("user_id", s.user.id)
          .maybeSingle();
        if (cancelled) return;
        if (!error) { op = data; break; }
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
        if (cancelled) return;
      }

      if (!op) {
        router.replace("/onboarding");
        return;
      }

      setOperatorId(op.id);
      setLoading(false);
    }

    let cancelled = false;
    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT" || !s) {
        router.replace("/login");
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  return { session, operatorId, loading };
}
