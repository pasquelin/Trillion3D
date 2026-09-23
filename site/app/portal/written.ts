import { courseEntries } from '../../content/course/page.ts';
import { GUIDES } from '../../content/entries/guides.ts';
import { INTERNALS } from '../../content/entries/internals.ts';
import { localizeEntries } from '../../content/i18n/entries.ts';
import type { Locale } from '../../content/locale.ts';
import type { PortalEntry } from '../../content/model.ts';

/** The written entries in `locale` — the course, the guides and the internals: small, loaded
 *  with the portal. */
export const writtenEntries = (locale: Locale): PortalEntry[] => [
  ...courseEntries(locale),
  ...localizeEntries([...GUIDES, ...INTERNALS], locale),
];
