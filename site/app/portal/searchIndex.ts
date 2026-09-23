import { t } from '../../content/i18n/index.ts';
import { examples as lessons } from '../../content/catalog.ts';
import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';
import type { PortalEntry } from '../../content/model.ts';
import { readyEntries } from '../examples/list.ts';
import { entryRoute, routeHref } from './routes.ts';
import type { SearchItem } from './search.ts';
import type { BadgeTone } from '../ui/Badge.tsx';

/** Everything the site search reads, in `locale`: every guide and API entry, every ready
 * example and every lesson. */
/** One colour per kind of page, so a result's badge says at a glance what it opens. */
const TONES: Record<string, BadgeTone> = {
  Guide: 'info',
  Example: 'success',
  Lesson: 'accent',
  Function: 'primary',
  Type: 'secondary',
  Constant: 'warning',
};

export function searchIndex(entries: PortalEntry[], locale: Locale): SearchItem[] {
  const pages = entries.map((entry) => ({
    key: `entry:${entry.id}`,
    title: entry.title || entry.id,
    text: [entry.id, entry.signature, entry.description, entry.module].filter(Boolean).join(' '),
    kind: t(locale, `kind.${entry.kind}`),
    tone: TONES[entry.kind] ?? 'neutral',
    href: entryRoute(entry, locale),
  }));
  const examples = readyEntries.map((entry) => ({
    key: `example:${entry.id}`,
    title: local(entry.title, locale),
    text: entry.id,
    kind: t(locale, 'kind.Example'),
    tone: TONES.Example,
    href: routeHref({ locale, area: 'examples', id: entry.id }),
  }));
  const lessonItems = lessons.map((lesson) => ({
    key: `lesson:${lesson.id}`,
    title: local(lesson.title, locale),
    text: `${lesson.id} ${local(lesson.description, locale)} ${(lesson.functions ?? []).join(' ')}`,
    kind: t(locale, 'kind.Lesson'),
    tone: TONES.Lesson,
    href: routeHref({ locale, area: 'lessons', id: lesson.id }),
  }));
  return [...pages, ...examples, ...lessonItems];
}
