import { create } from "zustand";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error";
}

interface ToastState {
  toasts: Toast[];
  add: (toast: Omit<Toast, "id">) => void;
  remove: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Store a toast in sessionStorage so it survives full-page navigations */
export function storeToast(message: string, type: "success" | "error" = "success") {
  sessionStorage.setItem("_toast", JSON.stringify({ message, type }));
}

/** Check sessionStorage for a pending toast, show it, then clear */
export function consumeStoredToast() {
  const raw = sessionStorage.getItem("_toast");
  if (!raw) return;
  sessionStorage.removeItem("_toast");
  try {
    const { message, type } = JSON.parse(raw) as { message: string; type: "success" | "error" };
    useToastStore.getState().add({ message, type });
  } catch {
    // ignore malformed
  }
}
