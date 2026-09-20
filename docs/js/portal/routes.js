export const DEFAULT_ROUTE = Object.freeze({ locale: 'en', area: 'learn', id: 'home' });
const AREAS = new Set(['learn', 'examples', 'playground', 'api']);
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

export function parseRoute(hash, fallbackLocale = 'en') {
  const parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'en' || parts[0] === 'fr') {
    const locale = parts[0];
    const area = AREAS.has(parts[1]) ? parts[1] : 'learn';
    const encodedId = parts.slice(2).join('/');
    let id = encodedId;
    try {
      id = decodeURIComponent(encodedId);
    } catch {
      /* Keep malformed external hashes stable so the not-found page can handle them. */
    }
    return { locale, area, id: id || (area === 'learn' ? 'home' : '') };
  }
  if (parts[0] === 'examples')
    return { locale: fallbackLocale, area: 'examples', id: parts[1] || '' };
  if (parts[0] === 'demo') return { locale: fallbackLocale, area: 'examples', id: 'engine-scene' };
  if (LEGACY_SECTIONS.has(parts[0])) {
    const area = parts[0] === 'guides' ? 'learn' : parts[0] === 'demo' ? 'playground' : 'api';
    return { locale: fallbackLocale, area, id: parts.at(-1) || '' };
  }
  return { ...DEFAULT_ROUTE, locale: fallbackLocale };
}

export function routeHref(route) {
  const id = route.id ? `/${encodeURIComponent(route.id)}` : '';
  return `#/${route.locale}/${route.area}${id}`;
}

export function localizedHref(hash, locale) {
  return routeHref({ ...parseRoute(hash, locale), locale });
}

export function entryRoute(entry, locale) {
  if (entry.section === 'guides') return routeHref({ locale, area: 'learn', id: entry.id });
  if (entry.section === 'examples') return routeHref({ locale, area: 'examples', id: entry.id });
  if (entry.section === 'demo') return routeHref({ locale, area: 'playground', id: entry.id });
  return routeHref({ locale, area: 'api', id: entry.id });
}

export function resolvePage(route, entries, exampleIds = []) {
  const entry = entries.find((candidate) => candidate.id === route.id);
  const isExample = exampleIds.includes(route.id);
  if (route.area === 'learn' && route.id === 'home') return { kind: 'home' };
  if (route.area === 'learn' && entry?.section === 'guides') return { kind: 'entry', entry };
  if (route.area === 'examples' && !route.id) return { kind: 'gallery' };
  if (route.area === 'examples' && route.id === 'engine-scene') return { kind: 'engine-scene' };
  if (route.area === 'examples' && isExample) return { kind: 'playground', id: route.id };
  if (route.area === 'examples' && entry?.section === 'examples') return { kind: 'entry', entry };
  if (route.area === 'playground' && isExample) return { kind: 'playground', id: route.id };
  if (route.area === 'api' && !route.id) return { kind: 'api-index' };
  if (route.area === 'api' && entry && !['guides', 'examples'].includes(entry.section)) {
    return { kind: 'entry', entry };
  }
  return { kind: 'not-found' };
}
