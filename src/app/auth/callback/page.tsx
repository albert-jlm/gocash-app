"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { completeAuthFromUrl, resolveAuthDestination } from "@/lib/auth";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function finishSignIn() {
      try {
        const session = await completeAuthFromUrl(window.location.href);
        const { destination } = await resolveAuthDestination(session);

        if (!cancelled) {
          router.replace(destination);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not finish sign-in.");
        }
      }
    }

    void finishSignIn();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-5 text-foreground">
        <div className="w-full max-w-sm rounded-3xl border border-red-500/20 bg-red-500/10 p-5 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
          <h1 className="mt-3 text-lg font-semibold">Sign-in failed</h1>
          <p className="mt-2 text-sm text-red-200">{error}</p>
          <Link
            href="/login"
            className="mt-4 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-900"
          >
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-5 text-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
      <p className="mt-3 text-sm text-muted-foreground">Completing sign-in…</p>
    </div>
  );
}
