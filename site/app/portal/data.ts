import { DEFAULT_LANGUAGE } from '../../content/i18n/dictionary.ts';
import { localizeEntries } from '../../content/i18n/entries.ts';
import { REFERENCE } from '../../content/entries/reference.ts';
import { REFERENCE_TRANSLATIONS } from '../../content/reference/translations.inline.ts';
import type { Locale } from '../../content/locale.ts';
import type { PortalEntry } from '../../content/model.ts';
import { writtenEntries } from './written.ts';

/** Every entry in `locale`: the written ones, then the API reference generated from the public
 *  declarations, through the language's translation. The reference and its translations are
 *  most of the weight, so the portal loads this module on its own, when the API area or the
 *  search needs it. */
export const entriesIn = (locale: Locale): PortalEntry[] => [
  ...writtenEntries(locale),
  ...localizeEntries(REFERENCE, locale, REFERENCE_TRANSLATIONS[locale]),
];

/** Every entry in English: what no language changes — ids, sections, routes. */
export const rawEntries = entriesIn(DEFAULT_LANGUAGE);
