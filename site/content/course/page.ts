import { CHAPTERS } from './code.ts';
import type { Locale } from '../locale.ts';
import type { PortalEntry } from '../model.ts';

/** A chapter's words in one language; `steps` and `tryIt` are HTML fragments. */
export interface ChapterText {
  title: string;
  /** The idea in one or two sentences: the first one is the page's lead. */
  description: string;
  steps: string[];
  /** What to change in the live result, and what happens. */
  tryIt: string;
}

/** The headings every chapter shares, per language. */
export interface CourseWords {
  picture: string;
  steps: string;
  code: string;
  tryIt: string;
  open: string;
  next: string;
  end: string;
}

/** The nine chapters, in order, as Learn entries in one language. */
export function courseEntries(
  texts: Record<string, ChapterText>,
  words: CourseWords,
  locale: Locale,
): PortalEntry[] {
  return CHAPTERS.map(({ id }, index) => {
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
      chapter: {
        example: CHAPTERS[index].example,
        code: CHAPTERS[index].code,
        steps: text.steps,
        tryIt: text.tryIt,
        next,
        words,
      },
    };
  });
}
