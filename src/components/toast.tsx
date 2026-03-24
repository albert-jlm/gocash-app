"use client";

import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { useToastStore } from "@/lib/toast-store";

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-[max(1rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-2.5 rounded-2xl border border-white/[0.1] bg-zinc-900/95 px-4 py-3 shadow-2xl backdrop-blur-xl animate-fade-up"
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4.5 h-4.5 text-red-400 flex-shrink-0" />
          )}
          <p className="text-sm font-medium flex-1">{toast.message}</p>
          <button
            onClick={() => remove(toast.id)}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/[0.1] flex-shrink-0"
          >
            <X className="w-3 h-3 text-muted-foreground" />
          </button>
        </div>
      ))}
    </div>
  );
}
