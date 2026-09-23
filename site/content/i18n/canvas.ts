import { DEFAULT_LANGUAGE, dictionaryOf } from './dictionary.ts';
import type { Locale } from '../locale.ts';

const VALUE = '{{value}}';

/** The value a pattern of the language's `canvas.patterns` finds in `text`, if it matches. */
const valueIn = (pattern: string, text: string) => {
  const [before, after] = pattern.split(VALUE);
  return text.startsWith(before) &&
    text.endsWith(after) &&
    text.length > pattern.length - VALUE.length
    ? text.slice(before.length, text.length - after.length)
    : undefined;
};

/**
 * A demo canvas draws its labels in English; this gives one in `locale`: a phrase of the
 * language's `canvas.phrases`, keyed by its English, or a `canvas.patterns` sentence around a
 * value. A trailing `(y …)` keeps its value and translates the rest; anything else stays as is.
 */
export function localizeDemoText(text: string, locale: Locale): string {
  const { phrases, patterns } = dictionaryOf(locale).canvas;
  if (Object.hasOwn(phrases, text)) return (phrases as Record<string, string>)[text];
  const english: Record<string, string> = dictionaryOf(DEFAULT_LANGUAGE).canvas.patterns;
  for (const [name, pattern] of Object.entries(english)) {
    const value = valueIn(pattern, text);
    if (value !== undefined)
      return (patterns as Record<string, string>)[name].replace(VALUE, value);
  }
  const height = /^(.+) \(y (.+)\)$/.exec(text);
  return height ? `${localizeDemoText(height[1], locale)} (y ${height[2]})` : text;
}
