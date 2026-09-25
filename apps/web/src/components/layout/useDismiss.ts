import { useEffect, type RefObject } from "react";

/**
 * Closes a popover on a click outside `ref` or on Escape, then hands focus back to the
 * button that opened it.
 */
export const useDismiss = (
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  returnFocusTo?: RefObject<HTMLElement | null>
) => {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        returnFocusTo?.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onClose, returnFocusTo]);
};

/** Moves focus between `[role=menuitem]` children with the arrow keys, Home and End. */
export const menuKeyNav = (event: React.KeyboardEvent<HTMLElement>) => {
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
  );
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (event.key === "ArrowDown") next = (index + 1) % items.length;
  else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  if (next >= 0) {
    event.preventDefault();
    items[next].focus();
  }
};
