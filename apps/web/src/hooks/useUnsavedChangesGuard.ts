import { useEffect } from "react";

type UnloadTarget = Pick<Window, "addEventListener" | "removeEventListener">;

/**
 * Registers a beforeunload prompt on `target` while `isDirty` is true. Returns the cleanup.
 */
export function attachUnsavedChangesPrompt(target: UnloadTarget, isDirty: boolean): () => void {
  if (!isDirty) return () => {};

  const handleBeforeUnload = (event: Event) => {
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = "";
  };

  target.addEventListener("beforeunload", handleBeforeUnload);
  return () => target.removeEventListener("beforeunload", handleBeforeUnload);
}

/**
 * Asks the browser to confirm before the tab is closed or reloaded while a form has unsaved edits
 * (R2H-B11). Pass the form's dirty flag, e.g. `formState.isDirty` from react-hook-form.
 *
 * In-app navigation is not guarded here: the app uses BrowserRouter, which has no navigation
 * blocker. Only the browser's own unload prompt is shown.
 */
export function useUnsavedChangesGuard(isDirty: boolean) {
  useEffect(() => attachUnsavedChangesPrompt(window, isDirty), [isDirty]);
}
