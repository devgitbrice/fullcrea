"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

export type ToastType = "info" | "success" | "error" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: string;
  type?: ToastType;
  durationMs?: number;
  action?: ToastAction;
}

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  durationMs: number;
  action?: ToastAction;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
  dismissAll: () => void;
}

const MAX_VISIBLE = 5;
const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 7000;

const TYPE_STYLES: Record<ToastType, { accent: string; icon: string; Icon: typeof Info }> = {
  info: { accent: "border-l-blue-500", icon: "text-blue-400", Icon: Info },
  success: { accent: "border-l-emerald-500", icon: "text-emerald-400", Icon: CheckCircle2 },
  error: { accent: "border-l-red-500", icon: "text-red-400", Icon: AlertCircle },
  warning: { accent: "border-l-amber-500", icon: "text-amber-400", Icon: AlertTriangle },
};

const ToastContext = createContext<ToastContextValue | null>(null);

// Fallback silencieux : un composant rendu hors du provider (tests, autres routes)
// ne doit pas planter, seulement ne rien afficher.
const NOOP_CONTEXT: ToastContextValue = {
  toast: () => -1,
  dismiss: () => {},
  dismissAll: () => {},
};

export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? NOOP_CONTEXT;
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const { id, message, type, durationMs, action } = item;
  const { accent, icon, Icon } = TYPE_STYLES[type];

  const [entered, setEntered] = useState(false);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(durationMs);
  const startedAtRef = useRef(0);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (paused || !Number.isFinite(durationMs) || durationMs <= 0) return;

    startedAtRef.current = Date.now();
    const timer = setTimeout(() => onDismiss(id), remainingRef.current);

    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
    };
  }, [paused, durationMs, id, onDismiss]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`
        pointer-events-auto flex items-start gap-2 rounded-md border border-gray-800 border-l-2 ${accent}
        bg-gray-950 px-3 py-2 text-xs text-gray-200 shadow-2xl
        transition-all duration-200 ease-out
        ${entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}
      `}
    >
      <Icon size={14} className={`mt-0.5 shrink-0 ${icon}`} />
      <p className="min-w-0 flex-1 break-words leading-relaxed">{message}</p>
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onClick();
            onDismiss(id);
          }}
          className="shrink-0 whitespace-nowrap font-medium text-blue-400 transition-colors hover:text-blue-300"
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label="Fermer"
        className="shrink-0 rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextIdRef.current++;
    const type = options.type ?? "info";
    const item: ToastItem = {
      id,
      message: options.message,
      type,
      durationMs: options.durationMs ?? (type === "error" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS),
      action: options.action,
    };
    setToasts((prev) => [...prev, item].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toast, dismiss, dismissAll }),
    [toast, dismiss, dismissAll]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-4 z-[150] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {toasts.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
