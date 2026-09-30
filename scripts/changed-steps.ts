import { TREE_GATES } from './validate-steps.ts';

// What `check:changed` runs for a change (`scripts/check-changed.ts`). A change that touches only
// documentation, site images or translations runs the gates that read those files, and no API
// generation, scene cache, type check or unit test: nothing it changed can reach them (#1348).

export const sourcePattern = /\.(?:[cm]?ts|tsx)$/;
export const formatPattern = /\.(?:[cm]?ts|tsx|json)$/;

const markdown = /\.md$/;
const translation = /^site\/(?:content\/|examples\/)?i18n\/[^/]+\.json$/;
// Images outside the trees whose tests and fixtures read them.
const siteImage = /^(?!tests\/|bench\/|packages\/).*\.(?:png|jpe?g|gif|webp|avif|svg)$/i;

/** Whether `file` is documentation, a site image or a translation, which no unit test reads. */
export function isDocumentation(file: string): boolean {
  return markdown.test(file) || translation.test(file) || siteImage.test(file);
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
 * `existing` still exist; `tests` is the number of unit tests the change selects.
 */
export function changedSteps(
  changed: readonly string[],
  existing: readonly string[],
  tests: number,
): ChangedStep[] {
  const code = !changed.every(isDocumentation);
  const steps: ChangedStep[] = code ? ['generate:api', 'compile:caches', 'check:lines'] : [];
  if (existing.some((file) => formatPattern.test(file))) steps.push('format');
  if (code) steps.push('lint', 'types', 'duplicates');
  if (existing.some((file) => markdown.test(file))) steps.push('check:links');
  if (existing.some((file) => translation.test(file))) steps.push('check:i18n');
  steps.push(...TREE_GATES);
  if (existing.some((file) => file.endsWith('.rs'))) steps.push('rust');
  if (code && tests) steps.push('tests');
  return steps;
}
