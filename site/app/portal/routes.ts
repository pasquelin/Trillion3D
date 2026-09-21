import type { Locale } from '../../content/locale.ts';
import type { PortalEntry } from '../../content/model.ts';

function decodeId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
/** The portal areas, in navigation order. */
export const AREAS = ['learn', 'examples', 'lessons', 'playground', 'api', 'reports'] as const;
export type RouteArea = (typeof AREAS)[number];

export interface PortalRoute {
  locale: Locale;
  area: RouteArea;
  id: string;
}

/** What a route resolves to, once the entries and examples are known. */
export type ResolvedPage =
  | { kind: 'report' }
  | { kind: 'home' }
  | { kind: 'entry'; entry: PortalEntry }
  | { kind: 'examples' }
  | { kind: 'example'; id: string }
  | { kind: 'gallery' }
  | { kind: 'engine-scene' }
  | { kind: 'playground'; id: string }
  | { kind: 'api-index' }
  | { kind: 'not-found' };

const DEFAULT_ROUTE: PortalRoute = Object.freeze({
  locale: 'en',
  area: 'learn',
  id: 'home',
});
const AREA_SET: ReadonlySet<string> = new Set(AREAS);
const isArea = (value: string | undefined): value is RouteArea =>
  value !== undefined && AREA_SET.has(value);
const LEGACY_SECTIONS = new Set([
  'guides',
  'demo',
  'enums',
  'lifecycle',
  'camera',
  'host',
  'matrices',
  'vectors',
  'colors',
  'bounds',
  'tree',
  'batches',
]);

export function parseRoute(hash: string, fallbackLocale: Locale = 'en'): PortalRoute {
  const parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'en' || parts[0] === 'fr') {
    const locale = parts[0];
    const area = isArea(parts[1]) ? parts[1] : 'learn';
    return {
      locale,
      area,
      id: decodeId(parts.slice(2).join('/')) || (area === 'learn' ? 'home' : ''),
    };
  }
  if (parts[0] === 'examples')
    return { locale: fallbackLocale, area: 'lessons', id: parts[1] || '' };
  if (parts[0] === 'demo') return { locale: fallbackLocale, area: 'lessons', id: 'engine-scene' };
  if (LEGACY_SECTIONS.has(parts[0])) {
    const area = parts[0] === 'guides' ? 'learn' : parts[0] === 'demo' ? 'playground' : 'api';
    return { locale: fallbackLocale, area, id: parts.at(-1) || '' };
  }
  return { ...DEFAULT_ROUTE, locale: fallbackLocale };
}

export function routeHref(route: PortalRoute) {
  const id = route.id ? `/${encodeURIComponent(route.id)}` : '';
  return `#/${route.locale}/${route.area}${id}`;
}

export function localizedHref(hash: string, locale: Locale) {
  return routeHref({ ...parseRoute(hash, locale), locale });
}

export function entryRoute(entry: PortalEntry, locale: Locale) {
  if (entry.section === 'guides') return routeHref({ locale, area: 'learn', id: entry.id });
  if (entry.section === 'examples') return routeHref({ locale, area: 'examples', id: entry.id });
  if (entry.section === 'demo') return routeHref({ locale, area: 'playground', id: entry.id });
  return routeHref({ locale, area: 'api', id: entry.id });
}

export function resolvePage(
  route: PortalRoute,
  entries: PortalEntry[],
  lessonIds: string[] = [],
  exampleIds: string[] = [],
): ResolvedPage {
  if (route.area === 'reports') return { kind: 'report' };
  const entry = entries.find((candidate) => candidate.id === route.id);
  const isLesson = lessonIds.includes(route.id);
  if (route.area === 'learn' && route.id === 'home') return { kind: 'home' };
  if (route.area === 'learn' && entry?.section === 'guides') return { kind: 'entry', entry };
  if (route.area === 'examples' && !route.id) return { kind: 'examples' };
  if (route.area === 'examples' && exampleIds.includes(route.id))
    return { kind: 'example', id: route.id };
  if (route.area === 'examples' && entry?.section === 'examples') return { kind: 'entry', entry };
  if (route.area === 'lessons' && !route.id) return { kind: 'gallery' };
  if (route.area === 'lessons' && route.id === 'engine-scene') return { kind: 'engine-scene' };
  if (route.area === 'lessons' && isLesson) return { kind: 'playground', id: route.id };
  if (route.area === 'playground' && isLesson) return { kind: 'playground', id: route.id };
  if (route.area === 'api' && !route.id) return { kind: 'api-index' };
  if (route.area === 'api' && entry && !['guides', 'examples'].includes(entry.section)) {
    return { kind: 'entry', entry };
  }
  return { kind: 'not-found' };
}
