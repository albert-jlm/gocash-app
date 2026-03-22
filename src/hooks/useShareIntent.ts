import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

/**
 * Listens for images shared to the app via Android's share sheet.
 * When an image is received, stores the shared file info in sessionStorage
 * and navigates to /capture where it's automatically processed.
 */
export function useShareIntent() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | undefined;

    async function setup() {
      try {
        const { CapacitorShareTarget } = await import("@capgo/capacitor-share-target");

        const listener = await CapacitorShareTarget.addListener(
          "shareReceived",
          (event) => {
            if (event.files?.length) {
              const file = event.files[0];
              sessionStorage.setItem(
                "shared_image",
                JSON.stringify({ uri: file.uri, mimeType: file.mimeType })
              );
              router.push("/capture");
            }
          }
        );

        cleanup = () => { listener.remove(); };
      } catch {
        // Plugin not available — silently ignore on web
      }
    }

    setup();

    return () => cleanup?.();
  }, [router]);
}
