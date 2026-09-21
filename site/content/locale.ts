/** The portal languages: every route carries one, every authored copy provides both. */
export type Locale = 'en' | 'fr';

/** Copy authored in both portal languages; the data never omits one. */
export type Localized = Record<Locale, string>;

export const local = (value: Localized, locale: Locale) => value[locale];
