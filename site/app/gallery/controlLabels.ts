import { dictionaryOf, wordFor } from '../../content/i18n/dictionary.ts';
import type { Locale } from '../../content/locale.ts';

/** The label of a lesson's control in `locale`, its `controls.<name>`, when the name has one. */
export const controlLabel = (name: string, locale: Locale) =>
  wordFor(dictionaryOf(locale).controls, name);
