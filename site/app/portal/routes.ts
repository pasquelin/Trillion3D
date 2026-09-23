import { DEFAULT_LANGUAGE, isLanguage } from '../../content/i18n/dictionary.ts';
import type { Locale } from '../../content/locale.ts';
import type { PortalEntry } from '../../content/model.ts';

function decodeId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The areas of the header, in navigation order; each but the sandbox has its own sidebar. */
const AREAS = ['learn', 'sandbox', 'examples', 'api', 'reports'] as const;
type NavArea = (typeof AREAS)[number];

/** The header's links: the areas, and the scene editor after Examples, whose page it is. */
const NAV_LINKS = ['learn', 'sandbox', 'examples', 'editor', 'api', 'reports'] as const;

export interface PortalRoute {
  locale: Locale;
  area: NavArea;
  id: string;
}

/** What a route resolves to, once the entries and examples are known. */
export type ResolvedPage =
  | { kind: 'report' }
  | { kind: 'home' }
  | { kind: 'entry'; entry: PortalEntry }
  | { kind: 'examples' }
  | { kind: 'example'; id: string }
  /** The sandbox, started from the example `id`, or from the default one when `id` is empty. */
  | { kind: 'sandbox'; id: string }
  | { kind: 'editor' }
  | { kind: 'api-index' }
  | { kind: 'not-found' };

const AREA_SET: ReadonlySet<string> = new Set(AREAS);
const isArea = (value: string | undefined): value is NavArea =>
  value !== undefined && AREA_SET.has(value);
/** The scene editor's page, under Examples beside the examples it is not one of. */
export const EDITOR_ID = 'scene-editor';
export const isEditorRoute = ({ area, id }: PortalRoute) => area === 'examples' && id === EDITOR_ID;
export const editorHref = (locale: Locale) =>
  routeHref({ locale, area: 'examples', id: EDITOR_ID });

/** The entry sections read in Learn, as guides; the others are the API reference. */
export const LEARN_SECTIONS = ['course', 'guides', 'internals'];

/**
 * The header's links for `route`: each area's first page and the scene editor, the one the route
 * shows current; the editor's route marks the editor, not Examples.
 */
export function navLinks(route: PortalRoute) {
  const { locale } = route;
  const here = isEditorRoute(route) ? 'editor' : route.area;
  return NAV_LINKS.map((link) => ({
    link,
    href:
      link === 'editor'
        ? editorHref(locale)
        : routeHref({ locale, area: link, id: link === 'learn' ? 'home' : '' }),
    current: here === link,
  }));
}

/** Whether the area has a sidebar on wide screens: the sandbox takes the whole width. */
export const hasSidebar = (route: PortalRoute) => route.area !== 'sandbox';

/**
 * Reads `#/<locale>/<area>/<id>`. A hash without a locale opens the home page in
 * `fallbackLocale`; an unknown area keeps its whole path as the id, which then resolves to no page.
 */
export function parseRoute(hash: string, fallbackLocale: Locale = DEFAULT_LANGUAGE): PortalRoute {
  const parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!isLanguage(parts[0])) return { locale: fallbackLocale, area: 'learn', id: 'home' };
  const [locale, area] = parts;
  if (!area) return { locale, area: 'learn', id: 'home' };
  if (!isArea(area)) return { locale, area: 'learn', id: decodeId(parts.slice(1).join('/')) };
  const id = decodeId(parts.slice(2).join('/'));
  return { locale, area, id: id || (area === 'learn' ? 'home' : '') };
}

export function routeHref(route: PortalRoute) {
  const id = route.id ? `/${encodeURIComponent(route.id)}` : '';
  return `#/${route.locale}/${route.area}${id}`;
}

export function entryRoute(entry: PortalEntry, locale: Locale) {
  const area = LEARN_SECTIONS.includes(entry.section) ? 'learn' : 'api';
  return routeHref({ locale, area, id: entry.id });
}

export function resolvePage(
  route: PortalRoute,
  entries: PortalEntry[],
  exampleIds: string[] = [],
): ResolvedPage {
  const { area, id } = route;
  if (area === 'reports') return { kind: 'report' };
  const entry = entries.find((candidate) => candidate.id === id);
  const learnEntry = entry && LEARN_SECTIONS.includes(entry.section);
  if (area === 'learn' && id === 'home') return { kind: 'home' };
  if (area === 'learn' && entry && learnEntry) return { kind: 'entry', entry };
  if (area === 'examples' && !id) return { kind: 'examples' };
  if (area === 'examples' && id === EDITOR_ID) return { kind: 'editor' };
  if (area === 'examples' && exampleIds.includes(id)) return { kind: 'example', id };
  if (area === 'sandbox' && (!id || exampleIds.includes(id))) return { kind: 'sandbox', id };
  if (area === 'api' && !id) return { kind: 'api-index' };
  if (area === 'api' && entry && !learnEntry) return { kind: 'entry', entry };
  return { kind: 'not-found' };
}
