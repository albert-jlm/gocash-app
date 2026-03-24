"use client";

import { useEffect, useRef } from "react";
import { Loader2, Trash2, AlertCircle } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmVariant?: "destructive" | "primary";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  confirmVariant = "destructive",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const isDestructive = confirmVariant === "destructive";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm px-5 pb-6 pt-10 sm:items-center animate-fade-in"
      onClick={(e) => {
        if (!loading && panelRef.current && !panelRef.current.contains(e.target as Node)) {
          onCancel();
        }
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-sm rounded-3xl border border-white/[0.08] bg-background p-6 shadow-2xl animate-scale-in"
      >
        <div className="flex flex-col items-center text-center mb-6">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${
              isDestructive ? "bg-red-500/15" : "bg-emerald-500/15"
            }`}
          >
            {isDestructive ? (
              <Trash2 className="w-6 h-6 text-red-400" />
            ) : (
              <AlertCircle className="w-6 h-6 text-emerald-400" />
            )}
          </div>
          <h3 className="text-base font-semibold mb-1.5">{title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-3 rounded-2xl text-sm font-medium bg-white/[0.07] text-muted-foreground hover:bg-white/[0.11] transition-colors disabled:opacity-50 tap-scale"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 tap-scale ${
              isDestructive
                ? "bg-red-500 text-white hover:bg-red-400 active:bg-red-600"
                : "bg-emerald-500 text-white hover:bg-emerald-400 active:bg-emerald-600"
            }`}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
