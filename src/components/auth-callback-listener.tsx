"use client";

import { useEffect } from "react";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { useRouter } from "next/navigation";
import { completeAuthFromUrl, isNativeAuthCallback, resolveAuthDestination } from "@/lib/auth";

export function AuthCallbackListener() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const listenerPromise = App.addListener("appUrlOpen", async ({ url }) => {
      if (!isNativeAuthCallback(url)) return;

      try {
        const session = await completeAuthFromUrl(url);
        const { destination } = await resolveAuthDestination(session);

        await Browser.close();

        if (!cancelled) {
          router.replace(destination);
        }
      } catch {
        if (!cancelled) {
          router.replace("/login");
        }
      }
    });

    return () => {
      cancelled = true;
      void listenerPromise.then((listener) => listener.remove());
    };
  }, [router]);

  return null;
}
