import { readFileSync } from 'node:fs'
import { NATIVE_CRATES } from './native-crates.ts'

// The golden checks a change of reference values runs (`check-changed.ts`): the values of
// `packages/math/golden/<name>.json` are read by the crates' `golden_twins` tests, each through a
// `Twin` of `file: "<name>"` (`packages/math/rust/src/golden.rs`), and by the TypeScript golden
// tests, each through `assertGolden('<name>', …)` (`packages/math/src/golden.fixture.ts`).

/** A file of reference values; its name is the first group. */
export const GOLDEN = /^packages\/math\/golden\/([^/]+)\.json$/

export interface GoldenChecks {
  /** The crates, from the repository root, whose `golden_twins` test reads a changed file. */
  crates: string[]
  /** The TypeScript golden tests that read a changed file. */
  tests: string[]
}

/** The golden checks of the `changed` files among the repository's `paths`, read by `read`. */
export function goldenChecks(
  changed: Iterable<string>,
  paths: readonly string[],
  read = (file: string) => readFileSync(file, 'utf8'),
): GoldenChecks {
  // A name is matched as written: a `.` or a `+` in it is no pattern.
  const names = [...changed]
    .flatMap((file) => GOLDEN.exec(file)?.[1] ?? [])
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const reads = (file: string, pattern: (name: string) => RegExp) =>
    names.some((name) => pattern(name).test(read(file)))
  return {
    crates: !names.length
      ? []
      : NATIVE_CRATES.map((crate) => crate.path).filter((crate) =>
          paths.some(
            (file) =>
              file.startsWith(`${crate}/src/`) &&
              file.endsWith('.rs') &&
              reads(file, (name) => new RegExp(`file:\\s*"${name}"`)),
          ),
        ),
    tests: !names.length
      ? []
      : paths.filter(
          (file) =>
            file.endsWith('.golden.test.ts') &&
            reads(file, (name) => new RegExp(`assertGolden\\(\\s*'${name}'`)),
        ),
  }
}
