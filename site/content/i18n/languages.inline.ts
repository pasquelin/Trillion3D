import { readJsonFolder } from './jsonFolder.ts';

/** A language's dictionary: its `meta`, then the portal's words by namespace, English the model. */
export type Dictionary = typeof import('../../i18n/en.json', { with: { type: 'json' } });

/** Every dictionary of `site/i18n/`, by language code: a language is added by adding its file. */
export const DICTIONARIES = readJsonFolder<Dictionary>(
  new URL('../../i18n/', import.meta.url),
  /^(.+)\.json$/,
);
