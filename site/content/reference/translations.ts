import { DEFAULT_LANGUAGE, isLanguage } from '../i18n/dictionary.ts';
import type { Locale } from '../locale.ts';
import type { ReferenceText } from './translate.ts';

/** One language's translation of the generated reference, by entry id. */
type ReferenceTranslation = Record<string, ReferenceText>;

const loaded: Record<Locale, ReferenceTranslation> = {};

/** The translation of the reference into `locale` once `loadReferenceTranslation` has read it;
 *  none for English, whose text is `api.json` itself. */
export const referenceTranslationOf = (locale: Locale): ReferenceTranslation | undefined =>
  loaded[locale];

/** Reads `api.<code>.json`, once: in the portal bundle each translation is a chunk of its own,
 *  fetched when the reference is first shown in that language. A language not translated yet
 *  shows the English. */
export async function loadReferenceTranslation(code: Locale): Promise<void> {
  if (code === DEFAULT_LANGUAGE || !isLanguage(code) || loaded[code]) return;
  try {
    loaded[code] = (await import('./api.' + code + '.json', { with: { type: 'json' } }))
      .default as ReferenceTranslation;
  } catch {
    // No `api.<code>.json` yet: `check:i18n` names it; the reference stays in English.
  }
}
