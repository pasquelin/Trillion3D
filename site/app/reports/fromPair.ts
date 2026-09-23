import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';

/** A pair of the report data (`site/reports/`), its English then its French, read in `locale`. */
export const fromPair = ([en, fr]: readonly string[], locale: Locale) => local({ en, fr }, locale);
