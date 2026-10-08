import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gitPathsSync } from './git-paths.ts'
import { localPaths } from './local-files.ts'

const root = resolve(import.meta.dirname, '..')

/** The TypeScript source folders of the packages, each its own namespace for the gates that read them. */
export const SOURCE_UNITS = [
  'packages/math/src',
  'packages/sdk-core/src',
  'packages/sdk-browser/src',
  'packages/sdk-node/src',
  'packages/page-codec/src',
] as const

/** The unit a maintained file belongs to, or null when it belongs to none: the gates read the
 *  packages and leave the scripts, the site and the bench to the gates that own them. */
export const unitOf = (file: string) =>
  SOURCE_UNITS.find((unit) => file.startsWith(unit + '/')) ?? null

const TEST_TS = /\.(?:test|fixture|perf|gpu)\.m?ts$/
const TEST_RS = /(?:^|\/)(?:tests?|\w+_tests?)(?:\.rs$|\/)/

/** Whether `file` is a test module, a fixture or a GPU proof, which may keep its own small copies. */
export const isTestModule = (file: string) =>
  file.endsWith('.rs') ? TEST_RS.test(file) : TEST_TS.test(file)

/** Shared tools inspect maintained files, never ignored personal files. */
export function repositoryFiles(directory = root): string[] | null {
  if (!existsSync(resolve(directory, '.git'))) return null
  return [
    ...new Set(
      gitPathsSync(['ls-files', '-co', '--exclude-standard', '-z'], directory).filter((file) =>
        existsSync(resolve(directory, file)),
      ),
    ),
  ]
}

/** The `.gitignore` local paths as globs: a bare name at any depth, a path from the root. */
export const localFileGlobs = (): string[] =>
  localPaths(root).map((path) => (path.includes('/') ? path : `**/${path}`))

/**
 * The maintained sources a gate reads, as path -> text, from the extensions it names.
 *
 * A gate that walks the tree wants the same three lines every time: the repository root, its tracked
 * files, and a map of the ones it cares about. `jscpd` found the third of them copied between
 * `check-helpers.ts` and `check-cohesion.ts`, which is what it is for.
 */
export function sourceFilesOf(
  extensions: RegExp,
  directory = root,
  keep: (file: string) => boolean = () => true,
): Map<string, string> {
  const tracked = repositoryFiles(directory)
  if (!tracked) throw new Error('Not a Git repository.')
  return new Map(
    tracked
      .filter((file) => extensions.test(file) && keep(file) && existsSync(resolve(directory, file)))
      .map((file): [string, string] => [file, readFileSync(resolve(directory, file), 'utf8')]),
  )
}
