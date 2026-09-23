import { localizeEntries } from '../../content/i18n/entries.ts';
import { REFERENCE } from '../../content/entries/reference.ts';
import {
  loadReferenceTranslation,
  referenceTranslationOf,
} from '../../content/reference/translations.ts';
import type { Locale } from '../../content/locale.ts';
import type { PortalEntry } from '../../content/model.ts';
import { loadLanguage } from '../i18n.ts';
import { writtenEntries } from './written.ts';

/** Every entry in `locale`: the written ones, then the API reference generated from the public
 *  declarations, through the language's translation. The reference is most of the weight, so the
 *  portal loads this module on its own, when the API area or the search needs it. The words are
 *  those `loadEntries` has read; English until then. */
export const entriesIn = (locale: Locale): PortalEntry[] => [
  ...writtenEntries(locale),
  ...localizeEntries(REFERENCE, locale, referenceTranslationOf(locale)),
];

/** Every entry in `locale`, once its words and its translation of the reference are read. */
export async function loadEntries(locale: Locale): Promise<PortalEntry[]> {
  await Promise.all([loadLanguage(locale), loadReferenceTranslation(locale)]);
  return entriesIn(locale);
}
