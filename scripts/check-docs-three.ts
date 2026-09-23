// The documentation describes the engine's own path. Three.js may be named in two places only:
// where it is measured against (a witness, a benchmark, a measurement) and where a host migrates
// away from it. A line of a tracked Markdown file that names the library passes when one of its
// enclosing headings says so; any other mention fails `validate` (#277).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { repositoryFiles } from './repository-files.ts';

/** A sentence that names the library, not the number: the capitalised word mid-sentence counts. */
const LIBRARY =
  /Three\.js|three\.js|THREE\.|@types\/three|[`'"]three(?:\/[^`'"]*)?[`'"]|(?<=[a-z,;:)] )Three(?:'s)?\b/;
const ALLOWED_SECTION = /\b(?:witness(?:es)?|migrat\w*|benchmarks?|measur\w*)\b/i;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;

export interface LibraryMention {
  line: number;
  text: string;
}

/** The lines of `markdown` that name the library outside a witness or migration section. */
export function libraryMentions(markdown: string): LibraryMention[] {
  const headings: string[] = [];
  const found: LibraryMention[] = [];
  let fenced = false;
  markdown.split('\n').forEach((text, index) => {
    if (FENCE.test(text)) fenced = !fenced;
    const heading = fenced ? null : HEADING.exec(text);
    if (heading) {
      headings.length = heading[1].length - 1;
      headings[heading[1].length - 1] = heading[2];
    }
    if (!LIBRARY.test(text)) return;
    if (headings.some((title) => title && ALLOWED_SECTION.test(title))) return;
    found.push({ line: index + 1, text: text.trim() });
  });
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = repositoryFiles();
  if (!files) throw new Error('Not a Git repository.');
  const failures = files
    .filter((file) => file.endsWith('.md'))
    .flatMap((file) =>
      libraryMentions(readFileSync(file, 'utf8')).map(
        (mention) => `${file}:${mention.line}: ${mention.text}`,
      ),
    );
  if (failures.length) {
    console.error(
      'Three.js is named outside a witness, benchmark, measurement or migration section:\n' +
        failures.join('\n'),
    );
    process.exitCode = 1;
  } else console.log('Three.js is named only where it is measured against or migrated from.');
}
