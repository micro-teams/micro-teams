// A tiny app-global toast so no action fails silently. Any component can call
// toast("…") / toast.error("…") and the user sees a transient message. Mounted once
// near the app root; renders a fixed, stacked, auto-dismissing list.

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "error" | "info" | "success";
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  success: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const BG: Record<ToastKind, string> = {
  error: "#dc2626",
  info: "#334155",
  success: "#15803d",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const api: ToastApi = {
    show,
    error: useCallback((m: string) => show(m, "error"), [show]),
    info: useCallback((m: string) => show(m, "info"), [show]),
    success: useCallback((m: string) => show(m, "success"), [show]),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto max-w-full rounded-lg px-4 py-2 text-sm text-white shadow-lg"
            style={{ background: BG[t.kind] }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
