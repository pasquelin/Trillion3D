import { dictionaryOf } from './dictionary.ts';
import { translateReference } from '../reference/translate.ts';
import type { ReferenceText } from '../reference/translate.ts';
import type { Locale } from '../locale.ts';
import type { PortalEntry } from '../model.ts';

/** A written entry's words in one language; `values` gives each named word's meaning, in order. */
interface WrittenText {
  title?: string;
  summary?: string;
  description?: string;
  html?: string;
  valuesTitle?: string;
  values?: string[];
}

/** An entry before its words: what no language changes. Its text is the language's `written`
 *  words, or the generated reference's English under its translation; `valueNames` names the
 *  words of a written table, which the language explains. */
export type EntryFrame = Omit<PortalEntry, 'description'> & {
  description?: string;
  valueNames?: string[];
};

/** `frames` in `locale`: each generated entry through its translation in `reference`, when the
 *  language has one, then through the language's written words. */
export function localizeEntries(
  frames: EntryFrame[],
  locale: Locale,
  reference: Record<string, ReferenceText> = {},
): PortalEntry[] {
  const written: Record<string, WrittenText | undefined> = dictionaryOf(locale).written;
  return frames.map(({ valueNames, ...frame }) => {
    const { values, ...lines } = written[frame.id] ?? {};
    const entry = {
      ...translateReference({ description: '', ...frame }, reference[frame.id]),
      ...lines,
    };
    if (valueNames && values)
      entry.values = valueNames.map((name, at) => ({ name, desc: values[at] }));
    return entry;
  });
}
