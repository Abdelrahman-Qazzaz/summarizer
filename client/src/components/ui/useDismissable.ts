import { useEffect, useRef } from "react";

/**
 * Closes a popover on an outside pointer press or Escape, and returns focus to
 * whatever opened it — the behaviour every menu in the app needs and none of
 * them should re-implement.
 */
export function useDismissable<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = useRef<T>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;

    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return ref;
}
