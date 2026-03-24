"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  ArrowLeft,
  ImageIcon,
  Camera,
  Loader2,
  AlertCircle,
  Sparkles,
  Upload,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Capacitor } from "@capacitor/core";
import { Camera as CapCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { buildFinancialSettingsHref } from "@/lib/platforms";
import { AppBottomNav } from "@/components/app-bottom-nav";

const isNative = Capacitor.isNativePlatform();

const PROCESSING_STEPS = [
  { icon: Upload, label: "Uploading screenshot…", sub: "Preparing image for analysis" },
  { icon: Sparkles, label: "AI is reading your receipt…", sub: "Extracting transaction details" },
  { icon: CheckCircle2, label: "Almost done…", sub: "Finalizing results" },
];

function ProcessingOverlay() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 1500);
    const t2 = setTimeout(() => setStep(2), 4000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const { icon: StepIcon, label, sub } = PROCESSING_STEPS[step];
  const progress = step === 0 ? 33 : step === 1 ? 66 : 90;

  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center z-50 animate-fade-in">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 50% 40% at 50% 50%, rgba(16,185,129,0.06) 0%, transparent 70%)",
          animation: "pulse-glow 3s ease-in-out infinite",
        }}
      />

      <div className="relative z-10 flex flex-col items-center">
        <div
          key={step}
          className="w-[72px] h-[72px] rounded-2xl bg-white/[0.07] flex items-center justify-center mb-6 animate-scale-in"
        >
          {step < 2 ? (
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
          ) : (
            <StepIcon className="w-8 h-8 text-emerald-400" />
          )}
        </div>
        <p className="text-base font-semibold mb-1.5">{label}</p>
        <p className="text-sm text-muted-foreground mb-8">{sub}</p>

        <div className="w-48 h-1 rounded-full bg-white/[0.08] overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500/60 transition-all duration-1000 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function CapturePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restorePlatformName, setRestorePlatformName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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

  const uploadBase64 = useCallback(
    async (base64: string, mimeType: string) => {
      setError(null);
      setRestorePlatformName(null);
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
        if (!response.ok) {
          if (data?.code === "missing_platform" && data?.missing_platform?.name) {
            setRestorePlatformName(data.missing_platform.name);
          }
          throw new Error(data.error || "Failed to read screenshot");
        }

        window.location.assign(`/transactions/?id=${data.transaction_id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
        setProcessing(false);
      }
    },
    [router]
  );

  const processImage = useCallback(
    async (file: File) => {
      const { base64, mimeType } = await compressImage(file);
      await uploadBase64(base64, mimeType);
    },
    [uploadBase64, compressImage]
  );

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
        if (err instanceof Error && err.message.includes("cancel")) return;
        setError(err instanceof Error ? err.message : "Camera error");
      }
    },
    [uploadBase64]
  );

  useEffect(() => {
    const stored = sessionStorage.getItem("shared_image");
    if (!stored) return;
    sessionStorage.removeItem("shared_image");

    async function handleShared() {
      try {
        const { uri, mimeType } = JSON.parse(stored!) as { uri: string; mimeType: string };

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

  const openGallery = useCallback(() => {
    if (isNative) {
      nativeCapture(CameraSource.Photos);
      return;
    }
    if (!inputRef.current) return;
    inputRef.current.removeAttribute("capture");
    inputRef.current.click();
  }, [nativeCapture]);

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
    <div
      className="relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col bg-background text-foreground"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <div
        className="pointer-events-none fixed inset-0 left-1/2 mx-auto w-full max-w-5xl -translate-x-1/2"
        style={{
          background: "radial-gradient(ellipse 60% 40% at 50% 45%, rgba(16,185,129,0.09) 0%, transparent 70%)",
        }}
      />

      <header className="relative z-10 flex items-center gap-3 px-4 pb-4 pt-safe sm:px-6 lg:px-8">
        <Link
          href="/"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <h1 className="text-base font-semibold">New Transaction</h1>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-4 pb-36 sm:px-6 lg:px-8">
        <div className="grid w-full max-w-4xl gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-center">
          <div
            className={[
              "flex w-full aspect-[5/4] max-h-[34rem] min-h-[20rem] flex-col items-center justify-center rounded-3xl transition-all duration-200 sm:aspect-[4/3] lg:mb-0",
              isDragging
                ? "bg-emerald-500/10 ring-2 ring-emerald-500"
                : "bg-white/[0.04] ring-1 ring-white/[0.07]",
            ].join(" ")}
          >
            <div className="rounded-full bg-white/[0.08] p-8 mb-5">
              <Camera className="w-16 h-16 text-zinc-400" />
            </div>
            <h2 className="text-[17px] font-semibold text-white mb-1.5">
              {isDragging ? "Drop it here" : "Capture Screenshot"}
            </h2>
            <p className="max-w-[240px] text-center text-sm leading-relaxed text-muted-foreground">
              {isDragging
                ? "Release to process the image"
                : "Any payment receipt — we'll extract the details"}
            </p>

            {!isDragging && (
              <div className="mt-5 flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5">
                <Sparkles className="w-3 h-3 text-emerald-400" />
                <span className="text-[11px] font-medium text-emerald-400">AI-powered extraction</span>
              </div>
            )}
          </div>

          <div className="w-full space-y-4 lg:max-w-[20rem]">
            {error && (
              <div className="w-full rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
                {restorePlatformName && (
                  <Link
                    href={buildFinancialSettingsHref("platforms", restorePlatformName)}
                    className="mt-3 inline-flex rounded-xl bg-white px-3 py-2 text-sm font-semibold text-zinc-900"
                  >
                    Re-add {restorePlatformName}
                  </Link>
                )}
              </div>
            )}

            <div className="w-full space-y-3">
              <button
                onClick={openGallery}
                className="h-14 w-full flex items-center justify-center gap-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 active:scale-[0.98] text-white font-semibold rounded-2xl text-[15px] transition-all tap-scale"
              >
                <ImageIcon className="w-5 h-5" />
                Pick from Gallery
              </button>
              <button
                onClick={openCamera}
                className="h-14 w-full flex items-center justify-center gap-2.5 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 active:scale-[0.98] border border-white/[0.08] text-white font-medium rounded-2xl text-[15px] transition-all tap-scale"
              >
                <Camera className="w-5 h-5" />
                Take a Photo
              </button>
            </div>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={handleFileChange}
        />
      </div>

      {processing && <ProcessingOverlay />}

      <AppBottomNav />
    </div>
  );
}
