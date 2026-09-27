import React, { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowRight, Plus, Search } from "lucide-react";

import { NAV_AREAS } from "../../../navigation/nav.config";
import { useVisibleAreas } from "../../../navigation/useNav";
import { useCommandPalette } from "../../../components/command-palette/paletteContext";
import { useT } from "../../../i18n/I18nProvider";

/**
 * Area hub (`/hub/:area`): the area's name, one to three green primary actions and chip
 * shortcuts, then a tile for every screen in the area the user may open, grouped as in the
 * sidebar. Everything comes from `navigation/nav.config.ts`.
 */
const AreaHubPage: React.FC = () => {
  const { area: areaId = "" } = useParams();
  const areas = useVisibleAreas();
  const { openPalette } = useCommandPalette();
  const { t } = useT();
  const area = areas.find((a) => a.id === areaId);
  const known = NAV_AREAS.some((a) => a.id === areaId);

  useEffect(() => {
    if (area) document.title = `${area.title} · Shiftline`;
    return () => {
      document.title = "Shiftline";
    };
  }, [area]);

  if (!area) return <Navigate to={known ? "/unauthorized" : "/404"} replace />;

  const Icon = area.icon;
  const ctas = (area.hub?.ctas ?? []).slice(0, 3);
  const chips = area.hub?.chips ?? [];
  const screenCount = area.groups.reduce((n, g) => n + g.screens.length, 0);

  return (
    <div className="flex flex-col gap-8 pb-4" data-testid="area-hub">
      {/* Header */}
      <section className="flex flex-col gap-6 pt-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-4">
          <span className="sl-brand-tile !h-14 !w-14 !rounded-[16px] shrink-0">
            <Icon size={26} aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="sl-h1 !text-[2rem] leading-tight">{area.title}</h1>
            <p className="sl-muted mt-1 max-w-xl">{area.description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={openPalette}
          className="sl-btn hidden self-start sm:inline-flex lg:self-auto"
          aria-label={t("hub.searchIn")}
        >
          <Search size={16} aria-hidden />
          {t("hub.findScreen")}
        </button>
      </section>

      {/* Primary actions and shortcuts */}
      {(ctas.length > 0 || chips.length > 0) && (
        <section aria-label="Quick actions" className="flex flex-col gap-4">
          {ctas.length > 0 && (
            <div className="flex flex-wrap gap-4 pb-1">
              {ctas.map((cta) => (
                <Link key={cta.label} to={cta.path} className="sl-cta sl-cta-lg">
                  {/^(new|add)\b/i.test(cta.label) && (
                    <Plus size={20} strokeWidth={2.5} aria-hidden />
                  )}
                  {cta.label}
                </Link>
              ))}
            </div>
          )}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <Link key={chip.label} to={chip.path} className="sl-chip">
                  {chip.label}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Screens */}
      {area.groups.map((group) => (
        <section key={group.id} aria-labelledby={`hub-${group.id}`}>
          <h2 id={`hub-${group.id}`} className="sl-section-label mb-3 !text-sm">
            {group.title}
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {group.screens.map((screen) => {
              const ScreenIcon = screen.icon;
              const action = screen.actions?.[0];
              return (
                <li key={screen.id} className="sl-tile sl-tile-hover relative flex">
                  <Link
                    to={screen.path}
                    className="flex min-h-[5.5rem] flex-1 items-start gap-3.5 rounded-[18px] p-4 pr-12"
                  >
                    <span className="sl-icon-tile">
                      <ScreenIcon size={20} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{screen.title}</span>
                      <span className="mt-0.5 block text-sm leading-snug text-ink-subtle">
                        {screen.description}
                      </span>
                    </span>
                  </Link>
                  {action ? (
                    <Link
                      to={action.path}
                      aria-label={action.title}
                      title={action.title}
                      className="sl-icon-btn absolute right-3 top-3 !h-9 !w-9"
                    >
                      <Plus size={16} aria-hidden />
                    </Link>
                  ) : (
                    <ArrowRight
                      size={16}
                      aria-hidden
                      className="pointer-events-none absolute right-4 top-5 text-ink-subtle"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="text-xs text-ink-subtle">
        {t(screenCount === 1 ? "hub.screenCountOne" : "hub.screenCount", {
          count: screenCount,
          area: area.title,
        })}
      </p>
    </div>
  );
};

export default AreaHubPage;
