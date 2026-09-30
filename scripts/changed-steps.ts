import { TREE_GATES } from './validate-steps.ts';

// What `check:changed` runs for a change (`scripts/check-changed.ts`). A change that touches only
// documentation, site images or translations runs the gates and the unit tests that read those
// files (`scripts/docs-tests.ts`), and no API generation, scene cache or type check (#1348).

export const sourcePattern = /\.(?:[cm]?ts|tsx)$/;
export const formatPattern = /\.(?:[cm]?ts|tsx|json)$/;

const markdown = /\.md$/;
// The notices ship in the package (`package.json` `files`): code, not documentation.
const packaged = /^THIRD_PARTY_NOTICES\.md$/;
const translation = /^site\/(?:content\/|examples\/)?i18n\/[^/]+\.json$/;
// Images outside the trees whose tests and fixtures read them.
const siteImage = /^(?!tests\/|bench\/|packages\/).*\.(?:png|jpe?g|gif|webp|avif|svg)$/i;

/** Whether `file` is documentation, a site image or a translation, which only the tests of
 *  `scripts/docs-tests.ts` read. */
export function isDocumentation(file: string): boolean {
  if (packaged.test(file)) return false;
  return markdown.test(file) || translation.test(file) || siteImage.test(file);
}

/** Whether `paths` touch anything but documentation: an empty list counts as code, so a change
 *  that could not be listed never skips a gate. */
export function isCodeChange(paths: readonly string[]): boolean {
  return !paths.length || !paths.every(isDocumentation);
}

/** A step of `check:changed`; `check:x` names the gate `node scripts/check-x.ts`. */
export type ChangedStep =
  | 'generate:api'
  | 'compile:caches'
  | 'check:lines'
  | 'format'
  | 'lint'
  | 'types'
  | 'duplicates'
  | 'check:links'
  | 'check:i18n'
  | (typeof TREE_GATES)[number]
  | 'rust'
  | 'tests';

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
  const code = isCodeChange(changed);
  const steps: ChangedStep[] = code ? ['generate:api', 'compile:caches', 'check:lines'] : [];
  if (existing.some((file) => formatPattern.test(file))) steps.push('format');
  const sources = existing.some((file) => sourcePattern.test(file));
  if (sources) steps.push('lint');
  if (code) steps.push('types');
  if (sources || existing.some((file) => file.endsWith('.rs'))) steps.push('duplicates');
  if (existing.some((file) => markdown.test(file))) steps.push('check:links');
  if (existing.some((file) => translation.test(file))) steps.push('check:i18n');
  steps.push(...TREE_GATES);
  if (existing.some((file) => file.endsWith('.rs'))) steps.push('rust');
  if (tests) steps.push('tests');
  return steps;
}
