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

      const { data: op } = await supabase
        .from("operators")
        .select("id")
        .eq("user_id", s.user.id)
        .maybeSingle();

      if (!op) {
        router.replace("/onboarding");
        return;
      }

      setOperatorId(op.id);
      setLoading(false);
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT" || !s) {
        router.replace("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return { session, operatorId, loading };
}
