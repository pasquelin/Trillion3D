import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

/**
 * The compiler's Rust inputs, read as `packages/asset-compiler-rust/build_inputs.rs` reads them
 * for the build's hash: the crates its manifest links from the repository, theirs too, and of
 * each the production sources — test code left out. One rule on both sides: a launch calls a
 * binary stale exactly when its hash would move.
 */

/** The `{ path = "…" }` entries of `directory`'s manifest in the tables that link into the build
 *  — every `…dependencies` table but `dev-dependencies` —, resolved from `directory`; none
 *  without a manifest. */
function manifestPaths(directory: string): string[] {
  const out: string[] = []
  let linked = false
  const manifest = join(directory, 'Cargo.toml')
  if (!statSync(manifest, { throwIfNoEntry: false })) return out
  for (const line of readFileSync(manifest, 'utf8').split('\n')) {
    const text = line.trim()
    if (text.startsWith('[')) {
      const name = text.slice(1).replace(/\]+$/, '')
      linked = name.endsWith('dependencies') && !name.endsWith('dev-dependencies')
    } else if (linked && text.includes('{')) {
      const path = /path = "([^"]*)"/.exec(text)?.[1]
      if (path !== undefined) out.push(join(directory, path))
    }
  }
  return out
}

/** The crates the compiler in `crate` builds from the repository, as paths from `crate`: its
 *  manifest's path dependencies, then theirs, each once. */
export function pathDependencies(crate: string): string[] {
  const crates: string[] = []
  const pending = manifestPaths(crate).map((path) => relative(crate, path))
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (crates.includes(next)) continue
    pending.push(...manifestPaths(join(crate, next)).map((path) => relative(crate, path)))
    crates.push(next)
  }
  return crates.sort()
}

/** Whether a file or folder name is test code by its name: `isTestModule`'s Rust rule
 *  (`scripts/repository-files.ts`), and the golden harness (`golden.rs`, `golden/`). */
const testNamed = (name: string) => /^(?:tests?|golden|\w+_tests?)$/.test(name.replace(/\.rs$/, ''))

interface Declaration {
  /** A `#[path]` file, or the path of `name.rs` and `name/` without extension. */
  module: string
  exact: boolean
  /** Gated by `#[cfg(test)]`. */
  test: boolean
}

const covers = ({ module, exact }: Declaration, file: string) =>
  exact ? file === module : file === `${module}.rs` || file.startsWith(module + sep)

/** The `mod name;` declarations of `file`, line comments cut; the attributes read are those
 *  between the declaration and the item before it. */
function declarations(file: string, text: string): Declaration[] {
  const here = dirname(file)
  const stem = basename(file, '.rs')
  const dir = ['lib', 'main', 'mod'].includes(stem) ? here : join(here, stem)
  const code = text
    .split('\n')
    .map((line) => line.split('//')[0])
    .join('\n')
  const out: Declaration[] = []
  for (const match of code.matchAll(/(?<![\p{L}\p{N}_])mod\s+([\p{L}\p{N}_]+)\s*;/gu)) {
    const before = code.slice(0, match.index)
    const head = before.slice(Math.max(...[';', '{', '}'].map((c) => before.lastIndexOf(c))) + 1)
    const path = /#\[path = "([^"]*)"/.exec(head)?.[1]
    out.push({
      module: path === undefined ? join(dir, match[1]) : join(here, path),
      exact: path !== undefined,
      test: head.includes('#[cfg(test)]'),
    })
  }
  return out
}

function rustFiles(directory: string, into: string[]) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) rustFiles(path, into)
    else if (entry.name.endsWith('.rs')) into.push(path)
  }
}

/** The production sources of the crate in `directory`: the `.rs` files of its `src` folder but
 *  the test code — those named as tests, the modules a `#[cfg(test)]` declares, and every module
 *  a test file declares, to the last. Empty when the crate has no `src`. */
export function productionSources(directory: string): string[] {
  const src = join(directory, 'src')
  const files: string[] = []
  if (statSync(src, { throwIfNoEntry: false })?.isDirectory()) rustFiles(src, files)
  files.sort()
  const declared = files.flatMap((file, by) =>
    declarations(file, readFileSync(file, 'utf8')).map((module) => ({ by, module })),
  )
  const test = files.map((file) => relative(src, file).split(sep).some(testNamed))
  for (;;) {
    const grown = files.flatMap((file, at) =>
      !test[at] &&
      declared.some(({ by, module }) => (module.test || test[by]) && covers(module, file))
        ? [at]
        : [],
    )
    if (grown.length === 0) break
    for (const at of grown) test[at] = true
  }
  return files.filter((_, at) => !test[at])
}
