/** A portal language: the code of one dictionary of `site/i18n/`, which every route carries. */
export type Locale = string;

/** A table of per-language copy read in `locale`: English is always given, the fallback of every
 * other language. */
export const local = <T>(value: { en: T } & Partial<Record<Locale, T>>, locale: Locale): T =>
  value[locale] ?? value.en;
