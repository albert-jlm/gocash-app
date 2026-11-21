"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  ScanLine,
  ImageIcon,
  Camera,
  Home,
  Plus,
  History,
  Settings,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Capacitor } from "@capacitor/core";
import { Camera as CapCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { AppShell } from "@/components/app-shell";

const isNative = Capacitor.isNativePlatform();

export default function CapturePage() {
  const router = useRouter();
  // Single ref — camera button sets capture attr dynamically (21st.dev pattern)
  const inputRef = useRef<HTMLInputElement>(null);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Compress image via Canvas before sending — reduces OpenAI token cost
  const compressImage = useCallback(async (file: File): Promise<{ base64: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1280;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = url;
    });
  }, []);

  // Core upload function — takes raw base64 + mime type
  const uploadBase64 = useCallback(
    async (base64: string, mimeType: string) => {
      setError(null);
      setProcessing(true);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          router.push("/login");
          return;
        }

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-transaction`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              image_base64: base64,
              mime_type: mimeType,
            }),
          }
        );

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to read screenshot");

        // The same receipt was captured before. If that one is already saved,
        // opening the confirm form on it could only fail; show the saved
        // transaction instead. A duplicate that is still a draft goes to the
        // confirm form like any other.
        if (data.duplicate && data.status !== "awaiting_confirm") {
          router.push(`/transactions?id=${data.transaction_id}&duplicate=1`);
          return;
        }

        router.push(`/confirm?id=${data.transaction_id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
        setProcessing(false);
      }
    },
    [router]
  );

  // Process a File object — compress then upload
  const processImage = useCallback(
    async (file: File) => {
      const { base64, mimeType } = await compressImage(file);
      await uploadBase64(base64, mimeType);
    },
    [uploadBase64, compressImage]
  );

  // Native Capacitor Camera — returns base64 directly
  const nativeCapture = useCallback(
    async (source: CameraSource) => {
      try {
        const photo = await CapCamera.getPhoto({
          quality: 90,
          resultType: CameraResultType.Base64,
          source,
          width: 1280,
          correctOrientation: true,
        });
        if (photo.base64String) {
          await uploadBase64(photo.base64String, `image/${photo.format}`);
        }
      } catch (err) {
        // User cancelled — not an error
        if (err instanceof Error && err.message.includes("cancel")) return;
        setError(err instanceof Error ? err.message : "Camera error");
      }
    },
    [uploadBase64]
  );

  // Check for shared image from Android share intent
  useEffect(() => {
    const stored = sessionStorage.getItem("shared_image");
    if (!stored) return;
    sessionStorage.removeItem("shared_image");

    async function handleShared() {
      try {
        const { uri, mimeType } = JSON.parse(stored!) as { uri: string; mimeType: string };

        // Fetch the shared file URI and convert to base64
        const response = await fetch(uri);
        const blob = await response.blob();
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        await uploadBase64(base64, mimeType || "image/jpeg");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read shared image");
      }
    }

    handleShared();
  }, [uploadBase64]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processImage(file);
      e.target.value = "";
    },
    [processImage]
  );

  // Gallery — native or browser fallback
  const openGallery = useCallback(() => {
    if (isNative) {
      nativeCapture(CameraSource.Photos);
      return;
    }
    if (!inputRef.current) return;
    inputRef.current.removeAttribute("capture");
    inputRef.current.click();
  }, [nativeCapture]);

  // Camera — native or browser fallback
  const openCamera = useCallback(() => {
    if (isNative) {
      nativeCapture(CameraSource.Camera);
      return;
    }
    if (!inputRef.current) return;
    inputRef.current.setAttribute("capture", "environment");
    inputRef.current.click();
    setTimeout(() => inputRef.current?.removeAttribute("capture"), 500);
  }, [nativeCapture]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file?.type.startsWith("image/")) processImage(file);
    },
    [processImage]
  );

  return (
    <AppShell active="screenshot" tabBar>
    <div
      className="relative flex flex-col flex-1"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <header className="px-6 pt-[calc(env(safe-area-inset-top)+1.25rem)] lg:pt-10 pb-4">
        <h1 className="text-[17px] font-semibold text-center">Scan a receipt</h1>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-8">
        <div
          className={[
            "w-full max-w-sm aspect-[4/3] rounded-[20px] flex flex-col items-center justify-center mb-6 transition-colors",
            isDragging ? "bg-primary/10 ring-2 ring-primary" : "bg-muted",
          ].join(" ")}
        >
          <ScanLine className="w-12 h-12 mb-4" strokeWidth={1.6} />
          <p className="text-[15px] font-medium">{isDragging ? "Drop it here" : "Choose a receipt screenshot"}</p>
          <p className="text-[13px] text-muted-foreground mt-1">You review it before it counts</p>
        </div>

        {/* Error */}
        {error && (
          <div className="w-full max-w-sm flex items-start gap-2.5 bg-destructive/10 rounded-2xl px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-[15px] text-destructive">{error}</p>
          </div>
        )}

        <div className="w-full max-w-sm space-y-2.5">
          <button
            onClick={openGallery}
            className="btn btn-primary w-full"
          >
            <ImageIcon className="w-5 h-5" />
            Pick from gallery
          </button>
          <button
            onClick={openCamera}
            className="btn btn-secondary w-full"
          >
            <Camera className="w-5 h-5" />
            Take a photo
          </button>
          <Link href="/new" className="block text-center text-[15px] text-muted-foreground underline underline-offset-4 py-3">
            Type it in
          </Link>
        </div>

        {/* Hidden single file input */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={handleFileChange}
        />
      </div>

      {/* Processing Overlay — full viewport, fully opaque */}
      {processing && (
        <div className="fixed inset-0 bg-background flex flex-col items-center justify-center z-50">
          <div className="w-[72px] h-[72px] rounded-2xl bg-muted flex items-center justify-center mb-6">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
          <p className="text-base font-semibold mb-1.5">Reading your screenshot…</p>
          <p className="text-[15px] text-muted-foreground">This usually takes a few seconds</p>
        </div>
      )}
    </div>
    </AppShell>
  );
}
