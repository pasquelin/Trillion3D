import { examples as lessons } from '../../content/catalog.ts';
import { dictionaryOf, wordFor } from '../../content/i18n/dictionary.ts';
import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';
import { entrySummary, SECTIONS } from '../../content/model.ts';
import { REPORT_SECTIONS } from '../../reports/presentation.ts';
import type { PortalEntry } from '../../content/model.ts';
import { readyThemes, thumbnailOf } from '../examples/list.ts';
import { expandEntryLinks } from '../portal/entryLinks.ts';
import { entryRoute, LEARN_SECTIONS, routeHref } from '../portal/routes.ts';
import type { PortalRoute } from '../portal/routes.ts';
import { search } from '../portal/search.ts';
import type { ExampleGroup } from './ExampleList.tsx';
import type { SidebarMenuGroup } from './SidebarMenu.tsx';
import { wordsOf } from '../i18n.ts';

/** A section's title: its `section.<id>` in the dictionary, or a family's own name. */
const sectionTitle = (id: string, locale: Locale) =>
  wordFor(dictionaryOf(locale).section, id) ?? id;

/** One group per entry section: Learn's guides, or the API reference's families. */
function entryGroups(entries: PortalEntry[], route: PortalRoute, learn: boolean) {
  const t = wordsOf(route.locale);
  return SECTIONS.filter((id) => LEARN_SECTIONS.includes(id) === learn)
    .map((section) => ({
      id: section,
      title: sectionTitle(section, route.locale),
      items: expandEntryLinks(entries.filter((entry) => entry.section === section)).map(
        ({ entry, key, label, primary, id }) => ({
          key,
          label,
          href:
            id === entry.id
              ? entryRoute(entry, route.locale)
              : routeHref({ locale: route.locale, area: 'api', id }),
          // Links of one entry that share its route: only the primary one is current.
          active:
            (id === route.id && (primary || id !== entry.id)) || (entry.id === route.id && primary),
          dot: entry.issue ? t('common.inDevelopment') : undefined,
        }),
      ),
    }))
    .filter(({ items }) => items.length > 0);
}

/** Learn: the guides, the SDK examples, then the lessons. */
export function learnMenu(entries: PortalEntry[], route: PortalRoute): SidebarMenuGroup[] {
  const lessonItems = lessons.map((lesson) => ({
    key: lesson.id,
    label: local(lesson.title, route.locale),
    href: routeHref({ locale: route.locale, area: 'lessons', id: lesson.id }),
    active: route.area === 'lessons' && route.id === lesson.id,
  }));
  return [
    ...entryGroups(entries, route, true),
    { id: 'lessons', title: wordsOf(route.locale)('sidebar.lessons'), items: lessonItems },
  ];
}

/** The API reference: one group per family of functions and types. */
export const apiMenu = (entries: PortalEntry[], route: PortalRoute) =>
  entryGroups(entries, route, false);

const SYMBOL = /^[A-Za-z_$][\w$.]*(\(\))?$/;

/** The API reference's index: one item per entry that names symbols — its names and its own
 * first sentence —, family by family; an entry titled by a sentence is a guide, and stays out. */
export function apiIndex(entries: PortalEntry[], route: PortalRoute) {
  return SECTIONS.filter((id) => !LEARN_SECTIONS.includes(id))
    .map((section) => ({
      id: section,
      title: sectionTitle(section, route.locale),
      items: entries
        .filter((entry) => entry.section === section)
        .filter((entry) =>
          (entry.title || entry.id).split(' · ').every((name) => SYMBOL.test(name)),
        )
        .map((entry) => ({
          id: entry.id,
          href: entryRoute(entry, route.locale),
          label: entry.title || entry.id,
          summary: entrySummary(entry),
        })),
    }))
    .filter(({ items }) => items.length > 0);
}

/** Examples: the ready examples theme by theme, with their thumbnails, those matching `query`. */
export function examplesMenu(route: PortalRoute, query = ''): ExampleGroup[] {
  return readyThemes
    .map(({ theme, entries }) => ({
      id: theme.id,
      title: local(theme.title, route.locale),
      items: search(
        entries.map((entry) => ({
          entry,
          title: local(entry.title, route.locale),
          text: entry.id,
        })),
        query,
      ).map(({ entry, title }) => ({
        key: entry.id,
        label: title,
        href: routeHref({ locale: route.locale, area: 'examples', id: entry.id }),
        active: entry.id === route.id,
        thumbnail: thumbnailOf(entry.id),
      })),
    }))
    .filter(({ items }) => items.length > 0);
}

/** Measurements: the parts of the current campaign's report. */
export function reportMenu(route: PortalRoute): SidebarMenuGroup[] {
  const [campaign = '', active = 'overview'] = route.id.split('/');
  const t = wordsOf(route.locale);
  const items = REPORT_SECTIONS.map((id) => ({
    key: id,
    label: t(`report.sections.${id}`),
    href: routeHref({ ...route, id: `${campaign}/${id}` }),
    active: id === active,
  }));
  return [{ id: 'report', title: t('nav.reports'), items }];
}
