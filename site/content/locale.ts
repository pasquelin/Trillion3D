/** A portal language: the code of one dictionary of `site/i18n/`, which every route carries. */
export type Locale = string;

/** Copy authored per language; English is always given, the fallback of every other language. */
export type Localized = { en: string } & Partial<Record<Locale, string>>;

/** A table of per-language copy read in `locale`: English when the table has no such language. */
export const local = <T>(value: { en: T } & Partial<Record<Locale, T>>, locale: Locale): T =>
  value[locale] ?? value.en;
