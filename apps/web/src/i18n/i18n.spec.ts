import { describe, expect, it } from "vitest";

import { NAV_AREAS, NAV_SECTIONS } from "../navigation/nav.config";
import { DETAIL_WORDS } from "../navigation/nav.utils";
import { en } from "./en";
import { localizeAreas, localizeSections, navKeys } from "./navI18n";
import { ta } from "./ta";
import { lookup, translate, translateDynamic } from "./translate";

/** TN-04: the Tamil dictionary is complete and the nav keys stay in step with nav.config. */

const enKeys = Object.keys(en).sort();
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe("Tamil dictionary", () => {
  it("has every English key and nothing else", () => {
    expect(Object.keys(ta).sort()).toEqual(enKeys);
  });

  it("has no empty values in either language", () => {
    for (const [key, value] of Object.entries(en)) expect(value.trim(), key).not.toBe("");
    for (const [key, value] of Object.entries(ta)) expect(value.trim(), key).not.toBe("");
  });

  it("keeps the same placeholders as English", () => {
    for (const key of enKeys) {
      const k = key as keyof typeof en;
      expect(placeholders(ta[k]), key).toEqual(placeholders(en[k]));
    }
  });

  it("is written in Tamil script, not transliterated English", () => {
    const tamil = /[஀-௿]/;
    // Brand names, codes and the language's own name are the only values allowed without Tamil.
    const latinOnly = Object.entries(ta).filter(([, value]) => !tamil.test(value));
    for (const [key, value] of latinOnly) {
      expect(
        ["language.english", "login.emailPlaceholder", "nav.link.purchases./invoice"],
        `${key}: ${value}`
      ).toContain(key);
    }
  });
});

describe("translate", () => {
  it("returns the Tamil text and fills placeholders with Indian-English digits", () => {
    expect(translate("ta", "shift.hourN", { hour: 3 })).toBe("மணி 3");
    expect(translate("en", "dispatch.totalUnits", { qty: 125000 })).toBe("Total: 1,25,000 units");
    expect(translate("ta", "dispatch.totalUnits", { qty: 125000 })).toBe(
      "மொத்தம்: 1,25,000 அலகுகள்"
    );
  });

  it("falls back to English for a missing or blank translation", () => {
    const saved = (ta as Record<string, string>)["common.save"];
    (ta as Record<string, string>)["common.save"] = "  ";
    try {
      expect(lookup("ta", "common.save")).toBe("Save");
    } finally {
      (ta as Record<string, string>)["common.save"] = saved;
    }
  });

  it("uses the caller's fallback for a run-time key with no entry", () => {
    expect(translateDynamic("ta", "nav.screen.accounts.day-book", "Day book")).toBe("Day book");
  });
});

describe("nav keys", () => {
  const titles = new Map<string, string>();
  for (const s of NAV_SECTIONS) titles.set(navKeys.section(s.id), s.title);
  for (const area of NAV_AREAS) {
    titles.set(navKeys.area(area.id), area.title);
    titles.set(navKeys.areaDesc(area.id), area.description);
    for (const l of [...(area.hub?.ctas ?? []), ...(area.hub?.chips ?? [])])
      titles.set(navKeys.link(area.id, l.path), l.label);
    for (const g of area.groups) {
      titles.set(navKeys.group(area.id, g.id), g.title);
      for (const screen of g.screens) {
        titles.set(navKeys.screen(screen.id), screen.title);
        titles.set(navKeys.screenDesc(screen.id), screen.description);
        for (const a of screen.actions ?? []) titles.set(navKeys.action(a.path), a.title);
      }
    }
  }
  for (const [segment, label] of Object.entries(DETAIL_WORDS))
    titles.set(`nav.crumb.${segment}`, label);

  it("every nav key names a real entry and carries its English title", () => {
    const navEntries = Object.entries(en).filter(([key]) => key.startsWith("nav."));
    expect(navEntries.length).toBeGreaterThan(100);
    for (const [key, value] of navEntries) {
      expect(titles.has(key), `${key} is not in nav.config`).toBe(true);
      expect(value, key).toBe(titles.get(key));
    }
  });

  it("localizes the sidebar without changing ids or paths", () => {
    const tr = (key: string, fallback: string) => translateDynamic("ta", key, fallback);
    const areas = localizeAreas(NAV_AREAS, tr);
    const production = areas.find((a) => a.id === "production")!;
    expect(production.title).toBe("உற்பத்தி");
    const board = production.groups
      .flatMap((g) => g.screens)
      .find((s) => s.id === "production.shift-board")!;
    expect(board.title).toBe("ஷிஃப்ட் செயல்பாட்டுப் பலகை");
    expect(board.path).toBe("/shift-execution");
    // The English title stays searchable from the command palette.
    expect(board.keywords).toContain("Shift execution board");
    // Accounting screens keep English.
    const accounts = areas.find((a) => a.id === "accounts")!;
    expect(accounts.groups[0].screens[0].title).toBe(
      NAV_AREAS.find((a) => a.id === "accounts")!.groups[0].screens[0].title
    );
    expect(localizeSections(NAV_SECTIONS, tr).map((s) => s.title)).toContain("செயல்பாடு");
  });
});
