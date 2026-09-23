import { CHAPTERS } from './code.ts';
import { dictionaryOf } from '../i18n/dictionary.ts';
import type { Locale } from '../locale.ts';
import type { PortalEntry } from '../model.ts';

/** A chapter's words in one language; `steps` and `tryIt` are HTML fragments. */
interface ChapterText {
  title: string;
  /** The idea in one or two sentences: the first one is the page's lead. */
  description: string;
  steps: string[];
  /** What to change in the live result, and what happens. */
  tryIt: string;
}

/** The nine chapters, in order, as Learn entries in `locale`: the words are the language's
 *  `course`, the example and the code are the chapter's own. */
export function courseEntries(locale: Locale): PortalEntry[] {
  const { words, chapters } = dictionaryOf(locale).course;
  const texts: Record<string, ChapterText> = chapters;
  return CHAPTERS.map(({ id, example, code }, index) => {
    const text = texts[id];
    const following = CHAPTERS[index + 1];
    const next = following
      ? {
          href: `#/${locale}/learn/${following.id}`,
          label: `${words.next} — ${texts[following.id].title}`,
        }
      : { href: `#/${locale}/examples`, label: words.end };
    return {
      id,
      section: 'course',
      kind: 'Chapter',
      title: `${index + 1}. ${text.title}`,
      description: text.description,
      chapter: { example, code, steps: text.steps, tryIt: text.tryIt, next, words },
    };
  });
}
