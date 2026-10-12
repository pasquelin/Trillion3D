import { GOLDEN } from './golden-checks.ts'
import { TREE_GATES } from './validate-steps.ts'

// What `check:changed` runs for a change (`scripts/check-changed.ts`). A change that touches only
// documentation — Markdown, and images outside the code trees — runs the gates, and no scene cache,
// type check or unit test.

export const sourcePattern = /\.[cm]?ts$/
export const formatPattern = /\.(?:[cm]?ts|json)$/

const markdown = /\.md$/
const MESSAGE_CATALOGUE = 'packages/sdk-node/src/messages/messages.json'
// The notices ship in the package (`package.json` `files`): code, not documentation.
const packaged = /^THIRD_PARTY_NOTICES\.md$/
// Images outside the code trees, whose tests, fixtures and scene sources read them.
const documentImage =
  /^(?!tests\/|bench\/|packages\/|scripts\/).*\.(?:png|jpe?g|gif|webp|avif|svg)$/i

/** Whether `file` is documentation: Markdown, or an image outside the code trees. */
function isDocumentation(file: string): boolean {
  if (packaged.test(file)) return false
  return markdown.test(file) || documentImage.test(file)
}

/** Whether `paths` touch anything but documentation: an empty list counts as code, so a change
 *  that could not be listed never skips a gate. */
export function isCodeChange(paths: readonly string[]): boolean {
  return !paths.length || !paths.every(isDocumentation)
}

/** A step of `check:changed`; `check:x` names the gate `node scripts/check-x.ts`. */
export type ChangedStep =
  | 'compile:caches'
  | 'check:lines'
  | 'check:cohesion'
  | 'format'
  | 'lint'
  | 'types'
  | 'duplicates'
  | 'check:unused'
  | (typeof TREE_GATES)[number]
  | 'rust'
  | 'golden'
  | 'tests'

/**
 * The steps of `check:changed`, in order, for the `changed` paths (deleted ones included), of which
 * `existing` still exist; `tests` is the number of unit tests the change selects.
 */
export function changedSteps(
  changed: readonly string[],
  existing: readonly string[],
  tests: number,
): ChangedStep[] {
  const code = isCodeChange(changed)
  const steps: ChangedStep[] = code ? ['compile:caches', 'check:lines'] : []
  if (existing.some((file) => formatPattern.test(file))) steps.push('format')
  const sources = existing.some((file) => sourcePattern.test(file))
  if (sources) steps.push('lint')
  // The bound a runtime module answers to instead of the line count. It reads the modules the
  // branch touches, so a change elsewhere in the tree is never held to it.
  if (sources) steps.push('check:cohesion')
  if (code) steps.push('types')
  if (sources || existing.some((file) => file.endsWith('.rs'))) steps.push('duplicates')
  // A deleted source can leave an export only its tests used: any code change, deletions included.
  if (code) steps.push('check:unused')
  steps.push(...TREE_GATES)
  // The compiler embeds the message catalogue (`asset-compiler-rust/src/messages.rs`). A golden
  // value alone is no Rust change: the `golden` step below holds it to the crates.
  if (existing.some((file) => file.endsWith('.rs') || file === MESSAGE_CATALOGUE))
    steps.push('rust')
  // A reference value changed: the crates' golden tests that read it hold it to the Rust; the
  // TypeScript ones, among the unit tests, hold the twins to it (`golden-checks.ts`).
  if (changed.some((file) => GOLDEN.test(file))) steps.push('golden')
  if (tests) steps.push('tests')
  return steps
}
