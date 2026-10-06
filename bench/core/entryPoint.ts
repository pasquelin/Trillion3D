// Which run a process is: the file it was started with, relative to the repository, and whether
// `node --test` runs it — what decides whether a GPU or a browser may start from it.
import { realpathSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** The repository, which entry paths are relative to. */
const REPOSITORY = join(import.meta.dirname, '..', '..')

/** The entry file, resolved and relative to the repository; `null` with none: `node -e`,
 *  `--eval`, `--print`, stdin, the REPL. */
export function entryPath(entry: string | undefined): string | null {
  if (!entry || process.execArgv.some((flag) => /^(-e|-p|--eval|--print)(=|$)/.test(flag)))
    return null
  try {
    return relative(REPOSITORY, realpathSync(entry)).split(sep).join('/')
  } catch {
    return null
  }
}

/** Whether the process runs under `node --test`: a runner's child (`NODE_TEST_CONTEXT`) or the
 *  runner itself (`--test`, with test isolation `none`). */
export const underNodeTest = () =>
  process.env.NODE_TEST_CONTEXT !== undefined || process.execArgv.includes('--test')
