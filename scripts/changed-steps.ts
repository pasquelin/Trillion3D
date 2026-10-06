import { TREE_GATES } from './validate-steps.ts'

// What `check:changed` runs for a change (`scripts/check-changed.ts`). A change that touches only
// documentation, site images or translations runs the gates and the unit tests that read those
// files (`scripts/docs/tests.ts`), and no API generation, scene cache or type check (#1348).

export const sourcePattern = /\.(?:[cm]?ts|tsx)$/
export const formatPattern = /\.(?:[cm]?ts|tsx|json)$/

const markdown = /\.md$/
const MESSAGE_CATALOGUE = 'packages/sdk-node/src/messages/messages.json'
// The notices ship in the package (`package.json` `files`): code, not documentation.
const packaged = /^THIRD_PARTY_NOTICES\.md$/
const translation = /^site\/(?:content\/|examples\/)?i18n\/[^/]+\.json$/
// English is the reference the site's code types its dictionaries from (`typeof english`,
// `site/content/i18n/dictionary.ts`): a change of it is type-checked, so it is code.
const english = /^site\/(?:content\/|examples\/)?i18n\/en\.json$/
// Images outside the trees whose tests and fixtures read them, and outside the scene sources and
// models the compiler cooks (`site/assets/examples/<scene>/source/`, `…/models/`), which the Rust
// tests and the scene caches read.
const siteImage =
  /^(?!tests\/|bench\/|packages\/|site\/assets\/.*\/(?:source|models)\/).*\.(?:png|jpe?g|gif|webp|avif|svg)$/i

/** Whether `file` is documentation, a site image or a translation, which only the tests of
 *  `scripts/docs/tests.ts` read. */
export function isDocumentation(file: string): boolean {
  if (packaged.test(file) || english.test(file)) return false
  return markdown.test(file) || translation.test(file) || siteImage.test(file)
}

/** Whether `paths` touch anything but documentation: an empty list counts as code, so a change
 *  that could not be listed never skips a gate. */
export function isCodeChange(paths: readonly string[]): boolean {
  return !paths.length || !paths.every(isDocumentation)
}

/** A step of `check:changed`; `check:x` names the gate `node scripts/check-x.ts`. */
export type ChangedStep =
  | 'generate:api'
  | 'compile:caches'
  | 'check:lines'
  | 'check:cohesion'
  | 'format'
  | 'lint'
  | 'types'
  | 'duplicates'
  | 'check:unused'
  | 'check:links'
  | 'check:i18n'
  | (typeof TREE_GATES)[number]
  | 'rust'
  | 'tests'

/**
 * The steps of `check:changed`, in order, for the `changed` paths (deleted ones included), of which
 * `existing` still exist; `tests` is the number of unit tests the change selects, those that read
 * documentation included.
 */
export function changedSteps(
  changed: readonly string[],
  existing: readonly string[],
  tests: number,
): ChangedStep[] {
  const code = isCodeChange(changed)
  const steps: ChangedStep[] = code ? ['generate:api', 'compile:caches', 'check:lines'] : []
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
  if (existing.some((file) => markdown.test(file))) steps.push('check:links')
  if (existing.some((file) => translation.test(file))) steps.push('check:i18n')
  steps.push(...TREE_GATES)
  // The compiler embeds the message catalogue (`asset-compiler-rust/src/messages.rs`).
  if (existing.some((file) => file.endsWith('.rs') || file === MESSAGE_CATALOGUE))
    steps.push('rust')
  if (tests) steps.push('tests')
  return steps
}
