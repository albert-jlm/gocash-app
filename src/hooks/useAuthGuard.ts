"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { resolveAuthDestination } from "@/lib/auth";

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
    let cancelled = false;

    async function syncAuth(nextSession: Session | null) {
      setLoading(true);

      try {
        const { destination, operatorId: nextOperatorId } = await resolveAuthDestination(nextSession);
        if (cancelled) return;

        setSession(nextSession);
        setOperatorId(nextOperatorId);
        setLoading(false);

        if (destination !== "/") {
          router.replace(destination);
        }
      } catch {
        if (cancelled) return;
        setSession(null);
        setOperatorId(null);
        setLoading(false);
        router.replace("/login");
      }
    }

    async function init() {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      void syncAuth(currentSession);
    }

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncAuth(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  return { session, operatorId, loading };
}
