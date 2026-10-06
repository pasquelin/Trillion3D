// The pre-commit hook's formatting (`scripts/hooks/pre-commit.ts`): the staged files `format:check`
// reads are written formatted and staged again, so a commit never carries a format the CI refuses.
import { execFileSync, spawnSync } from 'node:child_process'
import { formatPattern } from './changed-steps.ts'

/** The Rust crates `format:check` holds to `cargo fmt`. */
const CRATES = ['packages/asset-compiler-rust', 'packages/page-codec-wasm']

const git = (...args: string[]) =>
  execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean)
const run = (command: string, args: string[]) => {
  const done = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (done.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR')
const prettier = staged.filter((file) => formatPattern.test(file))
const crates = CRATES.filter((crate) => staged.some((file) => file.startsWith(`${crate}/`)))
const rust = staged.filter((file) => file.endsWith('.rs') && crates.some((c) => file.startsWith(c)))

// A file also changed outside the index would have those changes staged with its format.
const unstaged = new Set(git('diff', '--name-only'))
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
