import { readJsonFolder } from './jsonFolder.ts';

/** How a language names itself, in its dictionary's `meta`. */
interface LanguageMeta {
  name: string;
  abbr: string;
  hreflang: string;
  rtl: boolean;
}

/** The `meta` of every dictionary of `site/i18n/`, by language code: what the selector lists and
 *  the route accepts before any other dictionary loads. A language is added by adding its file. */
export const LANGUAGE_META = Object.fromEntries(
  Object.entries(
    readJsonFolder<{ meta: LanguageMeta }>(new URL('../../i18n/', import.meta.url), /^(.+)\.json$/),
  ).map(([code, { meta }]) => [code, meta]),
);
