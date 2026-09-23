import { readJsonFolder } from '../i18n/jsonFolder.ts';
import type { ReferenceText } from './translate.ts';

/** Every translation of the generated reference, `api.<language>.json`, by language code; the
 *  English is `api.json` itself. */
export const REFERENCE_TRANSLATIONS = readJsonFolder<Record<string, ReferenceText>>(
  new URL('./', import.meta.url),
  /^api\.(.+)\.json$/,
);
