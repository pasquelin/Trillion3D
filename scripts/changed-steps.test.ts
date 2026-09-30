import test from 'node:test';
import assert from 'node:assert/strict';
import { changedSteps, isDocumentation } from './changed-steps.ts';

test('a documentation, image or translation change runs no build or cache compilation, and only the tests that read it', () => {
  const changed = ['README.md', 'site/i18n/fr.json', 'site/assets/logo.png'];
  assert.deepEqual(changedSteps(changed, changed, 12), [
    'format',
    'check:links',
    'check:i18n',
    'check:translations',
    'check:english',
    'tests',
  ]);
  assert.ok(!changedSteps(changed, changed, 0).includes('tests'));
  // The notices ship in the package: code, not documentation.
  assert.equal(isDocumentation('THIRD_PARTY_NOTICES.md'), false);
});

test('a source change runs the gates, the type check and the tests it selects', () => {
  const changed = ['packages/sdk-core/src/a.ts', 'README.md'];
  const steps = changedSteps(changed, changed, 3);
  for (const step of ['generate:api', 'compile:caches', 'types', 'tests', 'check:links'] as const)
    assert.ok(steps.includes(step), step);
  // A fixture image is read by the tests: it is not documentation.
  assert.ok(changedSteps(['tests/fixtures/a.png'], [], 1).includes('tests'));
});
