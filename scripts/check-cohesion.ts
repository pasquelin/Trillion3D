// `pnpm run check:cohesion`: how long a function may be and how many paths it may take, in place of
// a bound on the file.
//
// `check:lines` held — nothing in the source exceeded 200 lines — while it stopped describing the
// code: 42 modules sat at exactly the bound and 14 commits in a week existed only to get back under
// it, one of them splitting a single import in two to save three lines. A line count on a file
// cannot see the two things that make a function hard to change, so it is measured here instead.
//
//   --changed   the two bounds read only the modules a branch touches, so new code meets them while
//               the functions that predate them are not a mass refactor: 532 of the tree's 9 207
//               functions are already over 60 lines, 160 over a complexity of 20.
//
// A bound is a ratchet. It is set at what the tree measures, it never rises to let a change through,
// and it falls as the tree is brought under it. What it does not measure is the number of
// declarations a module holds: the tree decomposes by responsibility at a fine grain on purpose, and
// a gate on that would condemn the style rather than a defect.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryFiles } from './repository-files.ts';
import { gitPathsSync } from './git-paths.ts';
import { functionsOf, isTestModule, unitOf } from './check-cohesion-measure.ts';

/** A function of a module this branch touches stays inside this many lines. */
export const MAX_FUNCTION_LINES = 60;

/** And inside this complexity, on the same terms: past twenty paths a unit test of it stops being
 *  readable, and the tree's own worst measures 65. */
export const MAX_COMPLEXITY = 20;

const EXTS = /\.m?ts$/;

/** Every function of `files` over a bound, as `file:line name: what it measures`, worst first. */
export function overBound(
  files: Map<string, string>,
  bound: { lines: number; complexity: number },
): string[] {
  const out: string[] = [];
  for (const [file, text] of files) {
    if (!unitOf(file) || isTestModule(file)) continue;
    for (const fn of functionsOf(file, text)) {
      if (fn.lines > bound.lines) out.push({ file, fn, what: `is ${fn.lines} lines` });
      else if (fn.complexity > bound.complexity)
        out.push({ file, fn, what: `has a complexity of ${fn.complexity}` });
    }
  }
  return out
    .sort((a, b) => b.fn.complexity - a.fn.complexity || b.fn.lines - a.fn.lines)
    .map(({ file, fn, what }) => `${file}:${fn.line} ${fn.name} ${what}`);
}

/** The maintained modules a branch touches, against `TRILLION3D_BASE_REF` or `develop`. */
export function changedFiles(root: string): Set<string> {
  const base = process.env.TRILLION3D_BASE_REF ?? 'develop';
  return new Set(
    gitPathsSync(['ls-files', '--others', '--exclude-standard'], root).concat(
      gitPathsSync(['diff', '--name-only', base, '--'], root),
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, '..');
  const tracked = repositoryFiles(root);
  if (!tracked) throw new Error('Not a Git repository.');
  const files = new Map(
    tracked
      .filter((file) => EXTS.test(file) && unitOf(file))
      .map((file): [string, string] => [file, readFileSync(join(root, file), 'utf8')]),
  );

  const touched = process.argv.includes('--changed') ? changedFiles(root) : new Set<string>();
  const scoped = new Map([...files].filter(([file]) => !touched.size || touched.has(file)));
  const over = overBound(scoped, { lines: MAX_FUNCTION_LINES, complexity: MAX_COMPLEXITY });
  for (const line of over) console.error(line);
  if (over.length) process.exitCode = 1;
  else
    console.log(
      `No function of the ${touched.size ? 'touched' : 'whole'} tree is over ${MAX_FUNCTION_LINES} ` +
        `lines or a complexity of ${MAX_COMPLEXITY}.`,
    );
}
