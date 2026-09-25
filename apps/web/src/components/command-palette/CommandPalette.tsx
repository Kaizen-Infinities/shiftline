import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CornerDownLeft, Search } from "lucide-react";

import { useVisibleAreas } from "../../navigation/useNav";
import { buildPaletteItems, searchPalette, type PaletteItem } from "../../navigation/search";
import { areaHome } from "../../navigation/nav.utils";
import { pushRecent, readRecent } from "../../navigation/storage";

interface CommandPaletteProps {
  onClose: () => void;
  /** Shell commands (theme, shortcuts, calculator) searched alongside the screens. */
  commands: PaletteItem[];
  onCommand: (command: string) => void;
}

interface Section {
  id: string;
  title: string;
  items: PaletteItem[];
}

const KIND_LABEL: Record<PaletteItem["kind"], string> = {
  area: "Area",
  screen: "Screen",
  action: "Action",
  command: "Command",
};

/**
 * ⌘K / Ctrl+K palette: fuzzy search over every screen the user may open, their create flows,
 * the hubs' primary actions and a few shell commands. Combobox + listbox pattern: focus stays in
 * the input, arrow keys move the active option, Enter opens it, Escape closes.
 */
const CommandPalette: React.FC<CommandPaletteProps> = ({ onClose, commands, onCommand }) => {
  const navigate = useNavigate();
  const areas = useVisibleAreas();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent] = useState<string[]>(() => readRecent());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const items = useMemo(() => [...buildPaletteItems(areas), ...commands], [areas, commands]);

  const sections: Section[] = useMemo(() => {
    const q = query.trim();
    if (q) {
      const results = searchPalette(items, q);
      const doing = results.filter((i) => i.kind === "action" || i.kind === "command").slice(0, 6);
      const going = results.filter((i) => i.kind === "screen" || i.kind === "area").slice(0, 14);
      const ordered = [
        { id: "screens", title: "Screens", items: going },
        { id: "actions", title: "Actions", items: doing },
      ];
      // The best match leads, so Enter opens what the person most likely meant.
      if (results[0] && (results[0].kind === "action" || results[0].kind === "command")) {
        ordered.reverse();
      }
      return ordered.filter((s) => s.items.length > 0);
    }
    const byId = new Map(items.map((i) => [i.id, i]));
    const recentItems = recent
      .map((id) => byId.get(id))
      .filter((i): i is PaletteItem => !!i)
      .slice(0, 5);
    // Suggested: the first primary action of each area the person can use.
    const suggested: PaletteItem[] = [];
    for (const area of areas) {
      const cta = area.hub?.ctas?.[0];
      if (!cta) continue;
      const match =
        items.find((i) => i.kind === "action" && i.path === cta.path) ??
        items.find((i) => i.kind === "screen" && i.path === cta.path);
      if (match && !suggested.includes(match)) suggested.push(match);
      if (suggested.length >= 6) break;
    }
    const areaItems = areas
      .filter((a) => !a.hidden)
      .map((a) => items.find((i) => i.kind === "area" && i.path === areaHome(a)))
      .filter((i): i is PaletteItem => !!i);
    return [
      { id: "recent", title: "Recent", items: recentItems },
      { id: "suggested", title: "Quick actions", items: suggested },
      { id: "areas", title: "Go to", items: areaItems },
    ].filter((s) => s.items.length > 0);
  }, [query, items, recent, areas]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const rows = useMemo(() => {
    let next = 0;
    return sections.map((s) => ({ ...s, rows: s.items.map((item) => ({ item, i: next++ })) }));
  }, [sections]);

  // Focus the input on open and give focus back to whatever opened the palette.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // Keep the active option in view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    pushRecent(item.id);
    onClose();
    if (item.command) onCommand(item.command);
    else if (item.path) navigate(item.path);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const count = flat.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (count) setActive((a) => (a + 1) % count);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (count) setActive((a) => (a - 1 + count) % count);
        break;
      case "Home":
        if (!query) {
          event.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (!query) {
          event.preventDefault();
          setActive(Math.max(0, count - 1));
        }
        break;
      case "PageDown":
        event.preventDefault();
        setActive((a) => Math.min(count - 1, a + 5));
        break;
      case "PageUp":
        event.preventDefault();
        setActive((a) => Math.max(0, a - 5));
        break;
      case "Enter":
        event.preventDefault();
        run(flat[active]);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      case "Tab":
        // Focus stays in the search field; the list is driven from here.
        event.preventDefault();
        break;
      default:
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-start justify-center p-3 pt-[8vh] sm:pt-[14vh]">
      <div className="sl-backdrop sl-anim-fade absolute inset-0" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search Shiftline"
        className="sl-popover sl-anim-pop relative flex max-h-[80vh] w-full max-w-[640px] flex-col overflow-hidden !rounded-[24px]"
      >
        <div className="flex items-center gap-3 border-b border-line-soft px-5">
          <Search size={20} aria-hidden className="shrink-0 text-ink-subtle" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? optionId(active) : undefined}
            aria-label="Search screens and actions"
            placeholder="Search screens and actions…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-16 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-subtle focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="sl-kbd cursor-pointer hover:text-ink"
            aria-label="Close search"
            tabIndex={-1}
          >
            Esc
          </button>
        </div>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Results"
          className="sl-scroll min-h-0 flex-1 overflow-y-auto p-2"
        >
          {rows.map((section) => (
            <div key={section.id} role="group" aria-labelledby={`${listId}-${section.id}`}>
              <div
                id={`${listId}-${section.id}`}
                className="sl-section-label px-3 pt-3 pb-1.5 !text-xs"
              >
                {section.title}
              </div>
              {section.rows.map(({ item, i }) => {
                const selected = i === active;
                const Icon = item.icon;
                return (
                  <div
                    key={`${section.id}-${item.id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    data-index={i}
                    onMouseMove={() => !selected && setActive(i)}
                    onClick={() => run(item)}
                    className={`flex cursor-pointer items-center gap-3 rounded-[14px] px-3 py-2.5 ${
                      selected ? "bg-nav-active" : ""
                    }`}
                  >
                    <span
                      className={`sl-icon-tile !h-9 !w-9 !rounded-[11px] ${
                        item.kind === "action"
                          ? "!bg-[color:var(--color-cta)] !text-[color:var(--color-cta-ink)]"
                          : ""
                      }`}
                    >
                      <Icon size={17} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {item.title}
                      </span>
                      <span className="block truncate text-xs text-ink-subtle">
                        {item.kind === "screen"
                          ? item.hint
                          : `${KIND_LABEL[item.kind]} · ${item.hint}`}
                      </span>
                    </span>
                    {item.badge && (
                      <span className="sl-kbd hidden sm:inline-flex">{item.badge}</span>
                    )}
                    {selected && (
                      <CornerDownLeft size={16} aria-hidden className="shrink-0 text-ink-muted" />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div className="px-4 py-12 text-center">
              <p className="text-sm font-semibold text-ink">Nothing matches “{query.trim()}”</p>
              <p className="mt-1 text-sm text-ink-subtle">
                Try a screen name, a document like “GRN”, or a tax like “TDS”.
              </p>
            </div>
          )}
        </div>

        <div
          className="hidden items-center gap-4 border-t border-line-soft px-5 py-3 text-xs text-ink-subtle sm:flex"
          aria-hidden
        >
          <span className="flex items-center gap-1.5">
            <span className="sl-kbd">↑</span>
            <span className="sl-kbd">↓</span> move
          </span>
          <span className="flex items-center gap-1.5">
            <span className="sl-kbd">Enter</span> open
          </span>
          <span className="flex items-center gap-1.5">
            <span className="sl-kbd">Esc</span> close
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CommandPalette;
