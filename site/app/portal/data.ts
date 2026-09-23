import type { Locale } from '../../content/locale.ts';
import type { PortalEntry } from '../../content/model.ts';
import { REFERENCE } from '../../content/entries/reference.ts';
import { localizeEntries } from '../../content/i18n/index.ts';
import { withWrittenFrench } from '../../content/i18n/overlays.ts';
import { referenceFr } from '../../content/i18n/reference.fr.ts';
import { writtenEntries } from './written.ts';

/** Every entry: the written ones, then the API reference generated from the public declarations.
 *  The reference is most of the weight, so the portal loads this module on its own, when the API
 *  area or the search needs it. */
export const rawEntries: PortalEntry[] = [...writtenEntries, ...REFERENCE];

const FRENCH = withWrittenFrench(referenceFr);

/** Every entry in `locale`. */
export const entriesIn = (locale: Locale) => localizeEntries(rawEntries, locale, FRENCH);
