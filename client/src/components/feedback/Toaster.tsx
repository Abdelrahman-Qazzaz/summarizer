import { useToast } from "../../hooks/toast/useToast";
import type { ToastKind } from "../../hooks/toast/context";

const kindStyles: Record<ToastKind, { container: string; icon: string; path: string }> = {
  success: {
    container:
      "bg-green-50 dark:bg-green-950/70 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200",
    icon: "text-green-600 dark:text-green-400",
    path: "M5 13l4 4L19 7",
  },
  error: {
    container:
      "bg-red-50 dark:bg-red-950/70 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200",
    icon: "text-red-600 dark:text-red-400",
    path: "M6 18L18 6M6 6l12 12",
  },
  info: {
    container:
      "bg-blue-50 dark:bg-blue-950/70 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200",
    icon: "text-blue-600 dark:text-blue-400",
    path: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
};

export function Toaster() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((toast) => {
        const style = kindStyles[toast.kind];
        return (
          <div
            key={toast.id}
            role="status"
            className={`flex items-start gap-3 p-3 rounded-xl border shadow-lg backdrop-blur-sm ${style.container}`}
          >
            <svg
              className={`w-5 h-5 flex-shrink-0 mt-0.5 ${style.icon}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={style.path}
              />
            </svg>
            <p className="flex-1 text-sm leading-snug">{toast.message}</p>
            <button
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
