import { createContext } from "react";

export type ToastKind = "success" | "error" | "info";

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
};

export type ToastInput = {
  kind?: ToastKind;
  message: string;
};

export type ToastContextValue = {
  toasts: Toast[];
  show: (toast: ToastInput) => void;
  dismiss: (id: string) => void;
};

export const ToastContext = createContext<ToastContextValue | null>(null);
