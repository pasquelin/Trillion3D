import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gitPaths as readGitPaths } from './git-paths.ts'

export const MAX_LINES = 200
const sourceFile = /\.(?:[cm]?js|[cm]?ts|jsx|tsx|rs)$/

/**
 * The bound the runtime source no longer answers to, and what answers in its place.
 *
 * A line count on a file stopped describing the code: 42 modules sat at exactly `MAX_LINES` and 14
 * commits in a week existed only to get back under it, `19ca7891a` splitting one 5-line import in
 * two to save three lines. What made a module hard to change was never its length but the length
 * and the branching of its functions, which a file bound cannot see — a module of six one-line
 * functions and a module of one 189-line function both passed it. `check:cohesion` measures those
 * two instead, on the modules a branch touches — the 405 functions of the tree already over 60 lines
 * are its queue rather than a failure, which is why it is not a step of `validate`.
 *
 * The tests keep the bound: a test is long by nature, its cases are its sections, and the split
 * that stays under it is by the behaviour under test (`b237eb625`). The scripts keep it too — they
 * are read whole, one gate or one step each.
 */
/** The maintained runtime modules `check:cohesion` reads instead. */
const RUNTIME_SOURCE = /^packages\/(?:sdk-core|sdk-browser|sdk-node|page-codec)\/src\//
const TEST_FILE = /\.(?:test|fixture|perf|gpu)\.m?ts$/

/** Whether the file still answers to the bound. A maintained runtime module of TypeScript does not,
 *  and `check:cohesion` reads it instead; a test, a fixture, a script, the site, the bench and the
 *  Rust crates all do — each is read whole, and a Rust function's length is not what makes it
 *  hard to change either, but no gate reads it yet, so the bound stays where it still holds. */
export const keepsLineBound = (file: string): boolean =>
  !RUNTIME_SOURCE.test(file) ||
  TEST_FILE.test(file) ||
  file.endsWith('/index.ts') ||
  file.endsWith('/index.mts')

/**
 * `-z` is an option, not a path. Placed after the `--` that opens the list of files, it is
 * read as a path to filter: `diff --name-only <ref> -- -z` then returns no names, and the
 * line check declared "no files modified" whatever we change. It is therefore inserted before
 * the separator, or at the end of arguments when there is none.
 */
export function nulSeparated(args: string[]): string[] {
  const separator = args.indexOf('--')
  return separator === -1
    ? [...args, '-z']
    : [...args.slice(0, separator), '-z', ...args.slice(separator)]
}

function gitPaths(args: string[]): Promise<string[]> {
  return readGitPaths(nulSeparated(args))
}

export function lineCount(source: string): number {
  if (!source) return 0
  return source.split('\n').length - Number(source.endsWith('\n'))
}

/** Every selected file that keeps the bound must fit it. A runtime module that does not is read by
 *  `check:cohesion` instead, and reporting it here would only restate a bound it no longer answers
 *  to. */
export function lineLimitViolations(
  lines: Map<string, number>,
  selected: Set<string> = new Set(lines.keys()),
): string[] {
  const errors: string[] = []
  for (const file of selected) {
    const count = lines.get(file)
    if (count !== undefined && count > MAX_LINES && keepsLineBound(file))
      errors.push(`${file}: ${count} lines; maximum ${MAX_LINES}`)
  }
  return errors
}

async function main(): Promise<void> {
  const changedOnly = process.argv.includes('--changed')
  const paths = new Set(await gitPaths(['ls-files', '-co', '--exclude-standard']))
  const changed = new Set(
    changedOnly
      ? [
          ...(await gitPaths([
            'diff',
            '--name-only',
            process.env.TRILLION3D_BASE_REF ?? 'develop',
            '--',
          ])),
          ...(await gitPaths(['ls-files', '--others', '--exclude-standard'])),
        ]
      : [...paths],
  )
  const lines = new Map(
    [...paths]
      .filter((file) => sourceFile.test(file) && existsSync(file))
      .map((file): [string, number] => [file, lineCount(readFileSync(file, 'utf8'))]),
  )
  const selected = new Set([...changed].filter((file) => sourceFile.test(file)))
  const errors = lineLimitViolations(lines, selected)
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  } else {
    console.log(`All checked source files have at most ${MAX_LINES} lines.`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
