import { describe, expect, it } from "vitest";
import { attachUnsavedChangesPrompt } from "./useUnsavedChangesGuard";

/** R2H-B11: a dirty form asks the browser to confirm before the tab closes or reloads. */
const fireBeforeUnload = (target: EventTarget) => {
  const event = new Event("beforeunload", { cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe("attachUnsavedChangesPrompt", () => {
  it("prompts before unload while the form is dirty", () => {
    const target = new EventTarget();
    attachUnsavedChangesPrompt(target as unknown as Window, true);
    expect(fireBeforeUnload(target).defaultPrevented).toBe(true);
  });

  it("does not prompt while the form is clean", () => {
    const target = new EventTarget();
    attachUnsavedChangesPrompt(target as unknown as Window, false);
    expect(fireBeforeUnload(target).defaultPrevented).toBe(false);
  });

  it("stops prompting once the cleanup runs", () => {
    const target = new EventTarget();
    const cleanup = attachUnsavedChangesPrompt(target as unknown as Window, true);
    cleanup();
    expect(fireBeforeUnload(target).defaultPrevented).toBe(false);
  });
});
