"use client";

import { useEffect } from "react";

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="sheet-fade absolute inset-0 bg-black/45 cursor-default active:!opacity-100 active:!scale-100" />
      <div className="sheet-rise relative w-full sm:max-w-sm bg-background rounded-t-[28px] sm:rounded-[28px] px-6 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-input sm:hidden" />
        <h2 className="text-[17px] font-semibold mb-1">{title}</h2>
        {children}
      </div>
    </div>
  );
}
