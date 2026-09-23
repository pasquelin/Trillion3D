import { kindName } from '../../content/i18n/dictionary.ts';
import type { Locale } from '../../content/locale.ts';
import type { PortalEntry } from '../../content/model.ts';
import { exampleTitle, readyEntries } from '../examples/list.ts';
import { entryRoute, routeHref } from './routes.ts';
import type { SearchItem } from './search.ts';
import type { BadgeTone } from '../ui/Badge.tsx';
import { wordsOf } from '../i18n.ts';

/** One colour per kind of page, so a result's badge says at a glance what it opens. */
const TONES: Record<string, BadgeTone> = {
  Guide: 'info',
  Example: 'success',
  Function: 'primary',
  Type: 'secondary',
  Constant: 'warning',
  Chapter: 'accent',
};

/** Everything the site search reads, in `locale`: every guide and API entry, and every ready
 * example. */
export function searchIndex(entries: PortalEntry[], locale: Locale): SearchItem[] {
  const t = wordsOf(locale);
  const pages = entries.map((entry) => ({
    key: `entry:${entry.id}`,
    title: entry.title || entry.id,
    text: [entry.id, entry.signature, entry.description, entry.module].filter(Boolean).join(' '),
    kind: kindName(entry.kind, locale),
    tone: TONES[entry.kind] ?? 'neutral',
    href: entryRoute(entry, locale),
  }));
  const examples = readyEntries.map((entry) => ({
    key: `example:${entry.id}`,
    title: exampleTitle(entry.id, locale),
    text: entry.id,
    kind: t('kind.Example'),
    tone: TONES.Example,
    href: routeHref({ locale, area: 'examples', id: entry.id }),
  }));
  return [...pages, ...examples];
}
