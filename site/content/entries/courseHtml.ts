import { CHAPTERS } from './courseCode.ts';
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

const escape = (code: string) =>
  code.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const heading = (text: string) => `<h2>${text}</h2>`;

/**
 * One chapter's page: a picture of what it builds, the steps, the few lines of code, the example
 * live in its frame — its own panel changes it —, then the link to the next chapter.
 */
function chapterHtml(
  index: number,
  text: ChapterText,
  next: { href: string; label: string },
  words: CourseWords,
  locale: Locale,
) {
  const { example, code } = CHAPTERS[index];
  const page = `#/${locale}/examples/${example}`;
  return [
    heading(words.picture),
    `<p><a href="${page}"><img class="rounded-box w-full max-w-xl" src="./assets/examples/thumbnails/${example}.png" alt="${text.title}" loading="lazy"></a></p>`,
    heading(words.steps),
    `<ol>${text.steps.map((step) => `<li>${step}</li>`).join('')}</ol>`,
    heading(words.code),
    ...code.map(
      (block) => `<pre class="rounded-box bg-base-200 p-4 text-sm"><code>${escape(block)}</code></pre>`,
    ),
    heading(words.tryIt),
    `<p>${text.tryIt}</p>`,
    `<div class="render-frame relative min-w-0 h-[min(60dvh,42rem)]"><iframe src="examples/${example}.html" title="${text.title}" loading="lazy"></iframe></div>`,
    `<p><a href="${page}">${words.open}</a></p>`,
    `<p><strong><a href="${next.href}">${next.label} →</a></strong></p>`,
  ].join('\n');
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
      ? { href: `#/${locale}/learn/${following.id}`, label: `${words.next}: ${texts[following.id].title}` }
      : { href: `#/${locale}/examples`, label: words.end };
    return {
      id,
      section: 'course',
      kind: 'Chapter',
      title: `${index + 1}. ${text.title}`,
      description: text.description,
      html: chapterHtml(index, text, next, words, locale),
    };
  });
}
