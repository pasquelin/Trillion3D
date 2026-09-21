import type { Locale } from '../types/portal.ts';

/** Copy authored in both portal languages; the data never omits one. */
export interface Localized {
  en: string;
  fr: string;
}

export const local = (value: Localized, locale: Locale): string => value[locale];
