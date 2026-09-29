import type { NavArea, NavSection } from "../navigation/nav.types";

/**
 * Nav labels by key (TN-04). `nav.config.ts` keeps its English titles as the source; the
 * dictionaries hold keys derived from the stable ids, so the config never changes shape:
 *
 *   nav.section.<sectionId>            nav.area.<areaId>        nav.area.<areaId>.desc
 *   nav.group.<areaId>.<groupId>       nav.screen.<screenId>    nav.screen.<screenId>.desc
 *   nav.link.<areaId>.<path>           nav.action.<path>
 *
 * A key the dictionary lacks keeps the English title (accounting screens stay English). The
 * English title is added to the keywords so the command palette still finds "GRN" in Tamil.
 */
export type NavTranslator = (key: string, fallback: string) => string;

export const navKeys = {
  section: (id: string) => `nav.section.${id}`,
  area: (id: string) => `nav.area.${id}`,
  areaDesc: (id: string) => `nav.area.${id}.desc`,
  group: (areaId: string, groupId: string) => `nav.group.${areaId}.${groupId}`,
  screen: (id: string) => `nav.screen.${id}`,
  screenDesc: (id: string) => `nav.screen.${id}.desc`,
  link: (areaId: string, path: string) => `nav.link.${areaId}.${path}`,
  action: (path: string) => `nav.action.${path}`,
};

const withEnglish = (keywords: string[] | undefined, english: string, shown: string) =>
  shown === english ? keywords : [...(keywords ?? []), english];

export const localizeSections = (sections: NavSection[], tr: NavTranslator): NavSection[] =>
  sections.map((s) => ({ ...s, title: tr(navKeys.section(s.id), s.title) }));

export const localizeAreas = (areas: NavArea[], tr: NavTranslator): NavArea[] =>
  areas.map((area) => {
    const title = tr(navKeys.area(area.id), area.title);
    return {
      ...area,
      title,
      description: tr(navKeys.areaDesc(area.id), area.description),
      keywords: withEnglish(area.keywords, area.title, title),
      hub: area.hub && {
        ctas: area.hub.ctas?.map((l) => ({
          ...l,
          label: tr(navKeys.link(area.id, l.path), l.label),
        })),
        chips: area.hub.chips?.map((l) => ({
          ...l,
          label: tr(navKeys.link(area.id, l.path), l.label),
        })),
      },
      groups: area.groups.map((group) => ({
        ...group,
        title: tr(navKeys.group(area.id, group.id), group.title),
        screens: group.screens.map((screen) => {
          const screenTitle = tr(navKeys.screen(screen.id), screen.title);
          return {
            ...screen,
            title: screenTitle,
            description: tr(navKeys.screenDesc(screen.id), screen.description),
            keywords: withEnglish(screen.keywords, screen.title, screenTitle),
            actions: screen.actions?.map((a) => {
              const actionTitle = tr(navKeys.action(a.path), a.title);
              return {
                ...a,
                title: actionTitle,
                keywords: withEnglish(a.keywords, a.title, actionTitle),
              };
            }),
          };
        }),
      })),
    };
  });
