// The pre-commit hook's formatting (`scripts/hooks/pre-commit.ts`): the staged files `format:check`
// reads are written formatted and staged again, so a commit never carries a format the CI refuses.
import { formatPattern } from './changed-steps.ts'
import { NATIVE_CRATES } from './native-crates.ts'
import { runChecked } from './run.ts'
import { git } from './git-paths.ts'

const paths = (...args: string[]) =>
  git(process.cwd(), ...args)
    .split('\n')
    .filter(Boolean)
const run = (command: string, args: string[]) => runChecked(command, args, { inherit: true })

const staged = paths('diff', '--cached', '--name-only', '--diff-filter=ACMR')
const prettier = staged.filter((file) => formatPattern.test(file))
const crates = NATIVE_CRATES.map((crate) => crate.path).filter((crate) =>
  staged.some((file) => file.startsWith(`${crate}/`)),
)
const rust = staged.filter((file) => file.endsWith('.rs') && crates.some((c) => file.startsWith(c)))

// A file also changed outside the index would have those changes staged with its format.
const unstaged = new Set(paths('diff', '--name-only'))
const partial = [...prettier, ...rust].filter((file) => unstaged.has(file))
if (partial.length) {
  console.error(`format-staged: stage the whole file, the hook formats it: ${partial.join(', ')}`)
  process.exit(1)
}
if (prettier.length)
  run('pnpm', [
    'exec',
    'prettier',
    '--ignore-path',
    '.gitignore',
    '--ignore-path',
    '.prettierignore',
    '--no-error-on-unmatched-pattern',
    '--log-level',
    'warn',
    '--write',
    ...prettier,
  ])
for (const crate of crates) run('cargo', ['fmt', '--all', '--manifest-path', `${crate}/Cargo.toml`])
if (prettier.length || rust.length) run('git', ['add', '--', ...prettier, ...rust])
