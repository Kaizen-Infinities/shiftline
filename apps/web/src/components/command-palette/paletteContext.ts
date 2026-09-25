import { createContext, useContext } from "react";

export interface PaletteContextValue {
  openPalette: () => void;
  closePalette: () => void;
  isOpen: boolean;
}

export const PaletteContext = createContext<PaletteContextValue>({
  openPalette: () => undefined,
  closePalette: () => undefined,
  isOpen: false,
});

/** Opens the command palette from anywhere inside the app shell. */
export const useCommandPalette = () => useContext(PaletteContext);

/** Anything outside the shell can open the palette with this window event. */
export const OPEN_PALETTE_EVENT = "shiftline:open-palette";
