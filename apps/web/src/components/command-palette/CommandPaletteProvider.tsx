import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Calculator, Keyboard, Moon, Sun } from "lucide-react";

import { useTheme } from "../../providers/ThemeProvider";
import type { PaletteItem } from "../../navigation/search";
import CommandPalette from "./CommandPalette";
import { OPEN_PALETTE_EVENT, PaletteContext } from "./paletteContext";

interface ProviderProps {
  children: React.ReactNode;
  onOpenShortcuts: () => void;
  onOpenCalculator: () => void;
}

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
};

/**
 * Owns the palette's open state and its hotkeys: Ctrl+K / ⌘K anywhere (even in a field) and
 * "/" outside fields. The listener is registered in a layout effect on the window's capture
 * phase, before the shell's global shortcut handler, so Ctrl+K opens search instead of the
 * legacy Ctrl+K → Stock jump.
 */
const CommandPaletteProvider: React.FC<ProviderProps> = ({
  children,
  onOpenShortcuts,
  onOpenCalculator,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { mode, toggle } = useTheme();
  const openRef = useRef(isOpen);
  useEffect(() => {
    openRef.current = isOpen;
  }, [isOpen]);

  const openPalette = useCallback(() => setIsOpen(true), []);
  const closePalette = useCallback(() => setIsOpen(false), []);

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key?.toLowerCase();
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
      if (mod && key === "k") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setIsOpen((open) => !open);
        return;
      }
      if (
        key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !openRef.current &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setIsOpen(true);
      }
    };
    const onEvent = () => setIsOpen(true);
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener(OPEN_PALETTE_EVENT, onEvent);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener(OPEN_PALETTE_EVENT, onEvent);
    };
  }, []);

  const commands: PaletteItem[] = useMemo(
    () => [
      {
        id: "command:theme",
        kind: "command",
        title: mode === "dark" ? "Switch to light theme" : "Switch to dark theme",
        hint: "Appearance",
        keywords: ["theme", "dark mode", "light mode", "appearance", "night"],
        icon: mode === "dark" ? Sun : Moon,
        command: "toggle-theme",
      },
      {
        id: "command:shortcuts",
        kind: "command",
        title: "Keyboard shortcuts",
        hint: "Help",
        keywords: ["keys", "hotkeys", "f1", "help"],
        icon: Keyboard,
        command: "shortcuts",
        badge: "F1",
      },
      {
        id: "command:calculator",
        kind: "command",
        title: "Calculator",
        hint: "Tools",
        keywords: ["calc", "sum", "compute"],
        icon: Calculator,
        command: "calculator",
        badge: "Alt+C",
      },
    ],
    [mode]
  );

  const onCommand = useCallback(
    (command: string) => {
      if (command === "toggle-theme") toggle();
      else if (command === "shortcuts") onOpenShortcuts();
      else if (command === "calculator") onOpenCalculator();
    },
    [toggle, onOpenShortcuts, onOpenCalculator]
  );

  const value = useMemo(
    () => ({ openPalette, closePalette, isOpen }),
    [openPalette, closePalette, isOpen]
  );

  return (
    <PaletteContext.Provider value={value}>
      {children}
      {isOpen && (
        <CommandPalette onClose={closePalette} commands={commands} onCommand={onCommand} />
      )}
    </PaletteContext.Provider>
  );
};

export default CommandPaletteProvider;
