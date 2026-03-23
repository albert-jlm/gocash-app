import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

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
              const normalizedUri =
                file.uri.startsWith("file://") || file.uri.startsWith("/")
                  ? Capacitor.convertFileSrc(file.uri)
                  : file.uri;

              sessionStorage.setItem(
                "shared_image",
                JSON.stringify({ uri: normalizedUri, mimeType: file.mimeType })
              );
              router.push("/capture");
            }
          }
        );

        cleanup = () => { listener.remove(); };
      } catch {
      }
    }

    setup();

    return () => cleanup?.();
  }, [router]);
}
